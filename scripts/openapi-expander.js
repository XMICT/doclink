import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';

// ─────────────────────────────────────────────────────────────────────────────
// El YAML fuente es OpenAPI estándar. Solo se apoya en tres marcadores que
// reutilizan los modelos Sequelize y payloads del repo hermano:
//
//   1. Entrada `{ model, fields, exclude, in? }` dentro de `parameters`
//        → in:"path" → params required:true, sin body_filtro.
//        → in:"query" (default) → query params + body_filtro.
//   2. Nodo de schema con `type: model` (+ `model`, `include`, `exclude`)
//        → schema inline: campos propios primero, asociaciones al final.
//   3. `schema: "<ruta>"` (string) dentro de `requestBody`
//        → carga y convierte el payload (Joi/AJV) del repo hermano.
//
//   + `type: catalog` (+ `catalog: Model.field`) dentro de un schema
//        → objeto/string con los valores de un enum declarado en x-enums.
//
// Todo lo demás se deja pasar tal cual: es OpenAPI válido.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Introspección via @alt3/sequelize-to-json-schemas (instalado en el backend) ─

const schemaCache = new Map();

function runBackendScript(script, backendPath) {
  return execSync('node --input-type=commonjs', {
    cwd: backendPath,
    input: script,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString();
}

function introspectSchema(modelName, backendPath) {
  const cacheKey = `schema::${backendPath}::${modelName}`;
  if (schemaCache.has(cacheKey)) return schemaCache.get(cacheKey);

  const script = `
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

// DataTypes.UUIDV4 y similares se serializan como {} — no es un default válido
for (const prop of Object.values(schema.properties ?? {})) {
  if (prop && typeof prop.default === 'object' && prop.default !== null &&
      !Array.isArray(prop.default) && Object.keys(prop.default).length === 0) {
    delete prop.default;
  }
}

const assocAliases = new Set(Object.keys(model.associations ?? {}));
const ownProperties = {};
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

  const raw = runBackendScript(script, backendPath);
  const marker = 'SYSTEM_SCHEMA:';
  const line = raw.split('\n').find(l => l.startsWith(marker));
  if (!line) throw new Error(`No se pudo introspeccionar el modelo ${modelName}`);

  const result = JSON.parse(line.slice(marker.length));
  schemaCache.set(cacheKey, result);
  return result;
}

// ─── Carga e introspección de payload files ────────────────────────────────────

const payloadCache = new Map();

function loadPayloadSchema(payloadPath, backendPath) {
  const cacheKey = `payload::${payloadPath}`;
  if (payloadCache.has(cacheKey)) return payloadCache.get(cacheKey);

  const absPath = payloadPath.replace(/\\/g, '/');

  const script = `
const payload = require('${absPath}');
const isJoi = !!(payload && payload.isJoi);
const data = isJoi ? payload.describe() : payload;
process.stdout.write('SYSTEM_PAYLOAD:' + JSON.stringify({ format: isJoi ? 'joi' : 'ajv', data }) + '\\n');
`;

  const raw = runBackendScript(script, backendPath);
  const marker = 'SYSTEM_PAYLOAD:';
  const line = raw.split('\n').find(l => l.startsWith(marker));
  if (!line) throw new Error(`No se pudo leer el payload: ${payloadPath}`);

  const { format, data } = JSON.parse(line.slice(marker.length));
  const schema = format === 'joi' ? convertJoiDescribe(data) : convertAjvSchema(data);

  payloadCache.set(cacheKey, schema);
  return schema;
}

// ─── Conversor AJV → OpenAPI ──────────────────────────────────────────────────

function convertAjvSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'string' };

  if (Array.isArray(schema.type)) {
    const isNullable = schema.type.includes('null');
    const baseType   = schema.type.find(t => t !== 'null') ?? 'string';
    const result     = convertAjvSchema({ ...schema, type: baseType });
    if (isNullable) result.nullable = true;
    return result;
  }

  switch (schema.type) {
    case 'object': {
      const result = { type: 'object' };
      if (schema.properties) {
        result.properties = Object.fromEntries(
          Object.entries(schema.properties).map(([k, v]) => [k, convertAjvSchema(v)])
        );
      }
      if (schema.required?.length)             result.required = schema.required;
      if (schema.additionalProperties === false) result.additionalProperties = false;
      return result;
    }
    case 'array': {
      const result = { type: 'array' };
      if (schema.items) result.items = convertAjvSchema(schema.items);
      return result;
    }
    case 'integer':
    case 'number': {
      const result = { type: schema.type };
      if (schema.positive) result.minimum = 1;
      if (schema.minmax) {
        const [min, max] = schema.minmax.limits;
        if (schema.minmax.include) { result.minimum = min; result.maximum = max; }
        else { result.exclusiveMinimum = min; result.exclusiveMaximum = max; }
      }
      if (schema.min !== undefined) result.minimum = schema.min;
      if (schema.max !== undefined) result.maximum = schema.max;
      return result;
    }
    case 'string': {
      const result = { type: 'string' };
      if (schema.max_l)  result.maxLength = schema.max_l;
      if (schema.min_l)  result.minLength = schema.min_l;
      if (schema.enum)   result.enum = schema.enum;
      if (schema.format) result.format = schema.format;
      return result;
    }
    case 'boolean':
      return { type: 'boolean' };
    default:
      return { type: schema.type ?? 'string' };
  }
}

// ─── Conversor Joi.describe() → OpenAPI ──────────────────────────────────────

function convertJoiDescribe(desc) {
  if (!desc || typeof desc !== 'object') return { type: 'string' };

  const rules = desc.rules ?? [];
  const allow = desc.allow ?? [];

  const isNullable = allow.some(v => v === null);
  const applyNullable = (schema) => {
    if (isNullable) schema.nullable = true;
    return schema;
  };

  switch (desc.type) {
    case 'object': {
      const result   = { type: 'object' };
      const required = [];
      if (desc.keys) {
        result.properties = {};
        for (const [key, keyDesc] of Object.entries(desc.keys)) {
          result.properties[key] = convertJoiDescribe(keyDesc);
          if (keyDesc.flags?.presence === 'required') required.push(key);
        }
      }
      if (required.length) result.required = required;
      return result;
    }
    case 'array': {
      const result = { type: 'array' };
      if (desc.items?.length) result.items = convertJoiDescribe(desc.items[0]);
      return applyNullable(result);
    }
    case 'number': {
      const isInteger = rules.some(r => r.name === 'integer');
      const result    = { type: isInteger ? 'integer' : 'number' };
      if (rules.some(r => r.name === 'positive')) result.minimum = 1;
      const minRule = rules.find(r => r.name === 'min');
      const maxRule = rules.find(r => r.name === 'max');
      if (minRule) result.minimum = minRule.args.limit;
      if (maxRule) result.maximum = maxRule.args.limit;
      return applyNullable(result);
    }
    case 'string': {
      const result  = { type: 'string' };
      const maxRule = rules.find(r => r.name === 'max');
      const minRule = rules.find(r => r.name === 'min');
      const patRule = rules.find(r => r.name === 'pattern');
      if (maxRule) result.maxLength = maxRule.args.limit;
      if (minRule) result.minLength = minRule.args.limit;
      if (patRule?.args?.regex) {
        result.pattern = String(patRule.args.regex).replace(/^\/|\/[gimsuy]*$/g, '');
      }
      return applyNullable(result);
    }
    case 'boolean':
      return applyNullable({ type: 'boolean' });
    case 'date':
      return applyNullable({ type: 'string', format: 'date-time' });
    default:
      return applyNullable({ type: desc.type ?? 'string' });
  }
}

// ─── Helpers de marcadores ────────────────────────────────────────────────────

// Normaliza una entrada de `fields` al formato { field, alias }.
// "campo"          → { field: "campo", alias: "campo" }
// ["campo", "as"]  → { field: "campo", alias: "as"   }
function parseField(entry) {
  return Array.isArray(entry)
    ? { field: entry[0], alias: entry[1] }
    : { field: entry,    alias: entry    };
}

// `exclude` puede ser una lista de campos o la palabra clave "virtuals".
function resolveExclude(exclude, virtuals = []) {
  if (exclude === 'virtuals') return new Set(virtuals);
  if (Array.isArray(exclude)) return new Set(exclude);
  return new Set();
}

// `fields` puede ser una lista (strings o [field, alias]), o estar ausente (→ todos).
// Devuelve { field, alias }[] filtrando por ownProperties y excludeSet.
function resolveFields(fields, ownProperties, excludeSet) {
  const all  = Object.keys(ownProperties).map(f => ({ field: f, alias: f }));
  const base = Array.isArray(fields) && fields.length ? fields.map(parseField) : all;
  return base.filter(({ field }) => ownProperties[field] && !excludeSet.has(field));
}

// Construye las propiedades de asociación a partir de un `include`.
// Cada entrada es un alias (string) o `{ model: alias, fields: [...] }`.
function buildAssocSchema(include, schemaData, backendPath) {
  const assocSchema = {};
  for (const raw of include) {
    const alias  = typeof raw === 'string' ? raw : raw.model;
    const fields = typeof raw === 'object' ? (raw.fields ?? null) : null;

    const assocRef = schemaData?.assocProperties?.[alias];
    if (!assocRef) continue;
    const targetModelName = assocRef['$ref']?.split('/').pop();
    if (!targetModelName) continue;

    try {
      const target = introspectSchema(targetModelName, backendPath);
      const entries = fields
        ? fields.map(parseField)
        : Object.keys(target.ownProperties).map(f => ({ field: f, alias: f }));
      const props = Object.fromEntries(
        entries
          .filter(({ field }) => target.ownProperties[field])
          .map(({ field, alias: fieldAlias }) => [fieldAlias, { ...target.ownProperties[field] }])
      );
      assocSchema[alias] = { type: 'object', properties: props };
    } catch (e) { /* modelo no encontrado, se omite la asociación */ }
  }
  return assocSchema;
}

// `type: model` → schema inline siempre (campos propios + asociaciones).
function expandModelSchema(node, ctx) {
  const include    = node.include ?? [];
  const schemaData = introspectSchema(node.model, ctx.backendPath);
  const excludeSet = resolveExclude(node.exclude, schemaData.virtuals ?? []);

  const properties = {};
  for (const [k, v] of Object.entries(schemaData.ownProperties ?? {})) {
    if (excludeSet.has(k)) continue;
    properties[k] = { ...v };
  }
  Object.assign(properties, buildAssocSchema(include, schemaData, ctx.backendPath));

  const required = (schemaData.required ?? []).filter(f => !excludeSet.has(f) && properties[f]);
  const out = { type: 'object', properties };
  if (required.length)            out.required = required;
  if (node.description)           out.description = node.description;
  if (node.example !== undefined) out.example = node.example;
  return out;
}

// `{ model, fields: [campo] }` sin `type` → schema del campo individual del modelo.
function expandFieldSchema(node, ctx) {
  const { field } = parseField(node.fields[0]);
  const schemaData = introspectSchema(node.model, ctx.backendPath);
  const prop = schemaData.ownProperties[field];
  return prop ? { ...prop } : { type: 'string' };
}

// Entrada `{ model, fields, exclude, in? }` en `parameters` → params del modelo.
// Si `in` es "path": required:true, sin body_filtro.
// Si `in` está ausente o es "query": query params + body_filtro.
function buildModelParams(entry, ctx) {
  const schemaData = introspectSchema(entry.model, ctx.backendPath);
  const excludeSet = resolveExclude(entry.exclude, schemaData.virtuals ?? []);
  const fields     = resolveFields(entry.fields, schemaData.ownProperties ?? {}, excludeSet);
  const location   = entry.in ?? 'query';
  const isPath     = location === 'path';

  const params = fields.map(({ field, alias }) => {
    const schema = { ...schemaData.ownProperties[field] };
    delete schema.nullable;
    return { name: alias, in: location, required: isPath, schema };
  });

  if (!isPath) {
    const example = fields.slice(0, 2).reduce((acc, { field, alias }) => {
      const fmt = schemaData.ownProperties[field]?.format;
      acc[alias] = { operador: 'eq', valor: fmt === 'uuid' ? '<uuid>' : 1 };
      return acc;
    }, {});

    params.push({
      name: 'body_filtro',
      in: 'query',
      required: false,
      description: 'Filtro avanzado en JSON. Operadores disponibles: `eq`, `neq`, `in`, `notIn`, `like`, `notLike`, `gt`, `gte`, `lt`, `lte`, `between`, `is`, `not`.',
      schema: { type: 'string', example: JSON.stringify(example) },
    });
  }

  return params;
}

// ─── Walker recursivo: resuelve marcadores y deja pasar el resto ───────────────

function expandParameters(arr, ctx) {
  const out = [];
  for (const entry of arr) {
    if (entry && typeof entry === 'object' && entry.model && !entry.name && !entry.$ref) {
      out.push(...buildModelParams(entry, ctx));
    } else {
      out.push(expandNode(entry, ctx));
    }
  }
  return out;
}

function expandNode(node, ctx) {
  if (Array.isArray(node)) return node.map(n => expandNode(n, ctx));
  if (!node || typeof node !== 'object') return node;

  // Resolver $ref a archivo externo (./file.yaml#/Pointer)
  const externalRef = node['$ref'];
  if (typeof externalRef === 'string' && !externalRef.startsWith('#')) {
    const [filePart, pointer = ''] = externalRef.split('#');
    const absFile = path.resolve(ctx.openapiDir, filePart);
    const fileContent = yaml.load(fs.readFileSync(absFile, 'utf-8'));
    const target = pointer.split('/').filter(Boolean).reduce((o, k) => o?.[k], fileContent);
    return expandNode(target ?? {}, ctx);
  }

  if (node.type === 'model' && node.model) return expandModelSchema(node, ctx);
  // { model, fields: [campo] } sin type → schema de un campo concreto del modelo
  if (node.model && Array.isArray(node.fields) && node.fields.length === 1 && !node.type) {
    return expandFieldSchema(node, ctx);
  }

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'parameters' && Array.isArray(v)) {
      out[k] = expandParameters(v, ctx);
    } else if (k === 'schema' && typeof v === 'string') {
      out[k] = loadPayloadSchema(path.resolve(ctx.openapiDir, v), ctx.backendPath);
    } else {
      out[k] = expandNode(v, ctx);
    }
  }
  return out;
}

// ─── Detección de marcadores ───────────────────────────────────────────────────

export function detectExtensions(spec) {
  if (!spec || typeof spec !== 'object') return false;

  const hasMarkers = (node) => {
    if (Array.isArray(node)) return node.some(hasMarkers);
    if (!node || typeof node !== 'object') return false;

    if (node.type === 'model') return true;
    if (node.model && Array.isArray(node.fields) && node.fields.length === 1 && !node.type) return true;

    for (const [k, v] of Object.entries(node)) {
      if (k === 'schema' && typeof v === 'string') return true;
      if (k === 'parameters' && Array.isArray(v) &&
          v.some(p => p && typeof p === 'object' && p.model && !p.name && !p.$ref)) {
        return true;
      }
      if (hasMarkers(v)) return true;
    }
    return false;
  };

  return hasMarkers(spec);
}

// ─── Función principal ────────────────────────────────────────────────────────

export function expandSpec(spec, backendPath, openapiDir) {
  const result = structuredClone(spec);

  delete result['x-enums'];

  const ctx = { backendPath, openapiDir };

  if (result.components?.schemas) {
    result.components.schemas = expandNode(result.components.schemas, ctx);
  }
  if (result.paths) result.paths = expandNode(result.paths, ctx);

  return result;
}
