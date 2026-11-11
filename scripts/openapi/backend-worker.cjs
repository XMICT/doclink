// Worker persistente de introspección. Se lanza una sola vez con cwd = backend y
// atiende peticiones por IPC: { id, type: 'model', name } | { id, type: 'payload', path }.
// Antes cada petición era un proceso Node nuevo que recargaba los ~300 modelos
// (~3 s por modelo); aquí los modelos se cargan una vez y se reutilizan.
//
// stdout se ignora en el padre (algunos modelos imprimen al cargarse); el stderr
// de cada operación se captura y se devuelve para extraer los warnings de Sequelize.

const Module = require('module');
const fs     = require('fs');
const path   = require('path');

const backendRequire = Module.createRequire(path.join(process.cwd(), '__doclink_worker__.js'));

function captureStderr(fn) {
  const origWrite = process.stderr.write;
  let buf = '';
  process.stderr.write = chunk => { buf += chunk; return true; };
  try { return { value: fn(), stderr: buf }; }
  catch (err) { err.stderr = buf; throw err; }
  finally { process.stderr.write = origWrite; }
}

// ── Modelos ───────────────────────────────────────────────────────────────────

let models;      // { db, DataTypes, JsonSchemaManager, OpenApi3Strategy, loadStderr }
const modelCache = new Map();

const STUBBED_DRIVERS = ['sqlite3', 'pg', 'pg-hstore', 'mysql2', 'mysql', 'tedious', 'oracledb', 'ibm_db'];

function loadModels() {
  if (models) return models;
  // Stub de drivers nativos solo mientras se cargan los modelos: nunca se abre una
  // conexión real. Se restaura después para que los payloads carguen como antes.
  const origLoad = Module._load;
  Module._load = function (req) {
    if (STUBBED_DRIVERS.includes(req)) return {};
    return origLoad.apply(this, arguments);
  };
  try {
    const { value, stderr } = captureStderr(() => {
      const { Sequelize, DataTypes } = backendRequire('sequelize');
      const { JsonSchemaManager, OpenApi3Strategy } = backendRequire('@alt3/sequelize-to-json-schemas');
      const seq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
      const db  = {};
      const modelsDir = path.resolve('models');
      fs.readdirSync(modelsDir)
        .filter(f => f !== 'index.js' && f.endsWith('.js') && !f.includes('.test.'))
        .forEach(file => {
          try {
            const model = backendRequire(path.join(modelsDir, file))(seq, DataTypes);
            db[model.name] = model;
          } catch { /* modelo inválido: se omite, igual que antes */ }
        });
      Object.values(db).forEach(m => m.associate && m.associate(db));
      return { db, DataTypes, JsonSchemaManager, OpenApi3Strategy };
    });
    models = { ...value, loadStderr: stderr };
    return models;
  } finally {
    Module._load = origLoad;
  }
}

const REF_TYPES = {
  Uuid:     { type: 'string', format: 'uuid' },
  DateTime: { type: 'string', format: 'date-time' },
  Date:     { type: 'string', format: 'date' },
  Blob:     { type: 'string', format: 'binary' },
};

function introspectModel(modelName) {
  const { db, DataTypes, JsonSchemaManager, OpenApi3Strategy, loadStderr } = loadModels();
  if (modelCache.has(modelName)) return modelCache.get(modelName);

  const model = db[modelName];
  if (!model) throw new Error(`Model not found: ${modelName}`);

  const { value, stderr } = captureStderr(() => {
    // Neutralizar el returnType de los campos VIRTUAL antes de generar: su schema real
    // se descarta más abajo de todos modos, y @alt3/sequelize-to-json-schemas truena con
    // VIRTUAL(STRING, [...]) — lee .options del wrapper VIRTUAL en vez de su returnType
    // (bug de esa versión de la librería en type-mapper.js).
    for (const attr of Object.values(model.rawAttributes)) {
      if (attr.type.constructor.name === 'VIRTUAL') attr.type = new DataTypes.VIRTUAL();
    }

    const manager = new JsonSchemaManager({ baseUri: '' });
    const schema  = manager.generate(model, new OpenApi3Strategy());

    // Campos VIRTUAL: schema vacío (cualquier tipo) y registro de sus nombres
    const virtuals = [];
    for (const [name, attr] of Object.entries(model.rawAttributes)) {
      if (attr.type.constructor.name === 'VIRTUAL') {
        virtuals.push(name);
        if (schema.properties[name]) {
          schema.properties[name] = attr.allowNull !== false ? { nullable: true } : {};
        }
      }
    }

    // Resolver $refs que @alt3 genera para tipos especiales (UUID, DATE, etc.)
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
      if (v && v.$ref) {
        const refName = v.$ref.split('/').pop();
        if (REF_TYPES[refName]) schema.properties[k] = REF_TYPES[refName];
      }
    }

    // DataTypes.UUIDV4 y similares se serializan como {} — no es un default válido en OpenAPI
    for (const prop of Object.values(schema.properties ?? {})) {
      if (prop && typeof prop.default === 'object' && prop.default !== null &&
          !Array.isArray(prop.default) && Object.keys(prop.default).length === 0) {
        delete prop.default;
      }
    }

    const assocAliases    = new Set(Object.keys(model.associations ?? {}));
    const ownProperties   = {};
    const assocProperties = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
      if (assocAliases.has(k)) assocProperties[k] = v;
      else ownProperties[k] = v;
    }

    // Round-trip JSON: mismo resultado que cuando viajaba por stdout del subproceso.
    return JSON.parse(JSON.stringify({ ownProperties, assocProperties, virtuals, required: schema.required ?? [] }));
  });

  // Los warnings de definición de modelos se reportan con cada modelo, como cuando
  // cada introspección cargaba todos los modelos en su propio proceso.
  const result = { data: value, stderr: loadStderr + stderr };
  modelCache.set(modelName, result);
  return result;
}

// ── Payloads ──────────────────────────────────────────────────────────────────

function loadPayload(absPath) {
  const { value, stderr } = captureStderr(() => {
    const payload = require(absPath);
    // payload.isJoi ya no existe desde Joi 17+ (reemplazado por Joi.isSchema()); se detecta
    // por duck-typing para no depender de la versión de Joi instalada en cada backend.
    const isJoi = !!(payload && typeof payload.describe === 'function' && typeof payload.validate === 'function');
    const data  = isJoi ? payload.describe() : payload;
    return JSON.parse(JSON.stringify({ format: isJoi ? 'joi' : 'ajv', data }));
  });
  return { data: value, stderr };
}

// ── IPC ───────────────────────────────────────────────────────────────────────

process.on('message', msg => {
  try {
    const { data, stderr } = msg.type === 'model' ? introspectModel(msg.name) : loadPayload(msg.path);
    process.send({ id: msg.id, ok: true, data, stderr });
  } catch (err) {
    process.send({ id: msg.id, ok: false, error: err?.message ?? String(err), stderr: err?.stderr ?? '' });
  }
});

process.on('disconnect', () => process.exit(0));
