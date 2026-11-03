import { spawn } from 'child_process';
import { convertAjvSchema, convertJoiDescribe } from './converters.js';

// Caches almacenan Promises para evitar doble ejecución con llamadas concurrentes.
const schemaCache  = new Map();
const payloadCache = new Map();

// Sequelize emite advertencias no fatales (p.ej. "SQLite does not support 'TINYINT'
// with UNSIGNED or ZEROFILL...") vía console.warn durante la definición de modelos.
// Se separan del resto del stderr para no confundirlas con el error real cuando el
// subproceso falla, y para poder mostrarlas como aviso en vez de como error.
const SEQUELIZE_WARNING_RE = /\(sequelize\) Warning: [^\n]*(?:\n>> Check: [^\n]*)?\n?/g;

function extractWarnings(stderr) {
  const warnings = [];
  const rest = stderr.replace(SEQUELIZE_WARNING_RE, match => {
    warnings.push(match.trim());
    return '';
  });
  return { warnings, rest: rest.trim() };
}

function runBackendScript(script, backendPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['--input-type=commonjs'], {
      cwd: backendPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => {
      const { warnings, rest } = extractWarnings(stderr);
      if (code !== 0) reject(Object.assign(new Error(rest || `exit ${code}`), { warnings }));
      else resolve({ stdout, warnings });
    });
    child.on('error', reject);
    child.stdin.write(script);
    child.stdin.end();
  });
}

export function introspectSchema(modelName, backendPath) {
  const cacheKey = `schema::${backendPath}::${modelName}`;
  if (schemaCache.has(cacheKey)) return schemaCache.get(cacheKey);

  const script = `
// Stub dialect native packages — we never open a real connection, only introspect model definitions.
const Module = require('module');
const _origLoad = Module._load;
Module._load = function(req, parent, isMain) {
  if (['sqlite3','pg','pg-hstore','mysql2','mysql','tedious','oracledb','ibm_db'].includes(req)) return {};
  return _origLoad.apply(this, arguments);
};
const { Sequelize, DataTypes } = require('sequelize');
const { JsonSchemaManager, OpenApi3Strategy } = require('@alt3/sequelize-to-json-schemas');
const fs = require('fs'), path = require('path');

const seq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
const db = {};

fs.readdirSync('./models')
  .filter(f => f !== 'index.js' && f.endsWith('.js') && !f.includes('.test.'))
  .forEach(file => {
    try {
      const model = require('./models/' + file)(seq, DataTypes);
      db[model.name] = model;
    } catch(e) {}
  });

Object.values(db).forEach(m => m.associate && m.associate(db));

const model = db['${modelName}'];
if (!model) throw new Error('Model not found: ${modelName}');

// Neutralizar el returnType de los campos VIRTUAL antes de generar: su schema real
// se descarta más abajo de todos modos, y @alt3/sequelize-to-json-schemas truena con
// VIRTUAL(STRING, [...]) — lee .options del wrapper VIRTUAL en vez de su returnType
// (bug de esa versión de la librería en type-mapper.js).
for (const attr of Object.values(model.rawAttributes)) {
  if (attr.type.constructor.name === 'VIRTUAL') {
    attr.type = new DataTypes.VIRTUAL();
  }
}

const manager = new JsonSchemaManager({ baseUri: '' });
const schema = manager.generate(model, new OpenApi3Strategy());

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
const REF_TYPES = {
  Uuid:     { type: 'string', format: 'uuid' },
  DateTime: { type: 'string', format: 'date-time' },
  Date:     { type: 'string', format: 'date' },
  Blob:     { type: 'string', format: 'binary' },
};
const REF_KEY = '$' + 'ref';
for (const [k, v] of Object.entries(schema.properties ?? {})) {
  if (v && v[REF_KEY]) {
    const refName = v[REF_KEY].split('/').pop();
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

const assocAliases = new Set(Object.keys(model.associations ?? {}));
const ownProperties  = {};
const assocProperties = {};

for (const [k, v] of Object.entries(schema.properties ?? {})) {
  if (assocAliases.has(k)) {
    assocProperties[k] = v;
  } else {
    ownProperties[k] = v;
  }
}

process.stdout.write('SYSTEM_SCHEMA:' + JSON.stringify({
  ownProperties,
  assocProperties,
  virtuals,
  required: schema.required ?? [],
}) + '\\n');
`;

  const promise = runBackendScript(script, backendPath).then(({ stdout, warnings }) => {
    const marker = 'SYSTEM_SCHEMA:';
    const line = stdout.split('\n').find(l => l.startsWith(marker));
    if (!line) throw new Error(`No se pudo introspeccionar el modelo ${modelName}`);
    return { ...JSON.parse(line.slice(marker.length)), warnings };
  });

  schemaCache.set(cacheKey, promise);
  return promise;
}

export function loadPayloadSchema(payloadPath, backendPath) {
  const cacheKey = `payload::${payloadPath}`;
  if (payloadCache.has(cacheKey)) return payloadCache.get(cacheKey);

  const absPath = payloadPath.replace(/\\/g, '/');

  const script = `
const payload = require('${absPath}');
// payload.isJoi ya no existe desde Joi 17+ (reemplazado por Joi.isSchema()); se detecta
// por duck-typing para no depender de la versión de Joi instalada en cada backend.
const isJoi = !!(payload && typeof payload.describe === 'function' && typeof payload.validate === 'function');
const data = isJoi ? payload.describe() : payload;
process.stdout.write('SYSTEM_PAYLOAD:' + JSON.stringify({ format: isJoi ? 'joi' : 'ajv', data }) + '\\n');
`;

  const promise = runBackendScript(script, backendPath).then(({ stdout, warnings }) => {
    const marker = 'SYSTEM_PAYLOAD:';
    const line = stdout.split('\n').find(l => l.startsWith(marker));
    if (!line) throw new Error(`No se pudo leer el payload: ${payloadPath}`);
    const { format, data } = JSON.parse(line.slice(marker.length));
    const schema = format === 'joi' ? convertJoiDescribe(data) : convertAjvSchema(data);
    return { schema, warnings };
  });

  payloadCache.set(cacheKey, promise);
  return promise;
}
