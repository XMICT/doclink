import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadPayloadSchema } from './introspect.js';
import { expandModelSchema, expandFieldSchema, buildModelParams } from './model-schema.js';

// ─── Predicados nombrados ─────────────────────────────────────────────────────
// Compartidos entre expandNode y detectExtensions para evitar que los criterios
// de detección y expansión diverjan silenciosamente.

const isExternalRef = node => typeof node['$ref'] === 'string' && !node['$ref'].startsWith('#');
const isModelSchema = node => node.type === 'model' && !!node.model;
const isFieldMarker = node => !!node.model && Array.isArray(node.fields) && node.fields.length === 1 && !node.type;
const isModelParam  = p    => p && typeof p === 'object' && !!p.model && !p.name && !p.$ref;

// ─── Walker recursivo ─────────────────────────────────────────────────────────

// Dentro de un archivo externo (ej. schemas.yaml), los fragmentos suelen referenciarse
// entre sí con un $ref local ("#/Fragmento"). Ese puntero es relativo AL ARCHIVO donde
// vive, no al documento OpenAPI final — ahí no existe un nodo raíz "/Fragmento". Se
// re-etiqueta con la misma ruta de archivo para que resuelva por el mismo camino que
// cualquier $ref externo.
function qualifyLocalRefs(node, filePart) {
  if (Array.isArray(node)) return node.map(n => qualifyLocalRefs(n, filePart));
  if (!node || typeof node !== 'object') return node;
  if (typeof node['$ref'] === 'string' && node['$ref'].startsWith('#')) {
    return { ...node, $ref: `${filePart}${node['$ref']}` };
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, qualifyLocalRefs(v, filePart)]));
}

async function resolveExternalRef(ref, ctx) {
  const [filePart, pointer = ''] = ref.split('#');
  const absFile    = path.resolve(ctx.openapiDir, filePart);
  const fileContent = yaml.load(fs.readFileSync(absFile, 'utf-8'));
  const target     = pointer.split('/').filter(Boolean).reduce((o, k) => o?.[k], fileContent);
  return expandNode(qualifyLocalRefs(target ?? {}, filePart), ctx);
}

async function expandParameters(arr, ctx) {
  const results = await Promise.all(arr.map(entry =>
    isModelParam(entry) ? buildModelParams(entry, ctx) : expandNode(entry, ctx).then(n => [n])
  ));
  return results.flat();
}

async function expandObject(node, ctx) {
  const entries = await Promise.all(
    Object.entries(node).map(async ([k, v]) => {
      if (k === 'parameters' && Array.isArray(v)) return [k, await expandParameters(v, ctx)];
      if (k === 'schema'     && typeof v === 'string') return [k, await loadPayloadSchema(path.resolve(ctx.openapiDir, v), ctx.backendPath)];
      return [k, await expandNode(v, ctx)];
    })
  );
  return Object.fromEntries(entries);
}

async function expandNode(node, ctx) {
  if (Array.isArray(node))               return Promise.all(node.map(n => expandNode(n, ctx)));
  if (!node || typeof node !== 'object') return node;
  if (isExternalRef(node))               return resolveExternalRef(node['$ref'], ctx);
  if (isModelSchema(node))               return expandModelSchema(node, ctx);
  if (isFieldMarker(node))               return expandFieldSchema(node, ctx);
  return expandObject(node, ctx);
}

// ─── Detección de marcadores ──────────────────────────────────────────────────

export function detectExtensions(spec) {
  if (!spec || typeof spec !== 'object') return false;

  function hasMarkers(node) {
    if (Array.isArray(node)) return node.some(hasMarkers);
    if (!node || typeof node !== 'object') return false;
    if (isModelSchema(node) || isFieldMarker(node)) return true;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'schema'     && typeof v === 'string') return true;
      if (k === 'parameters' && Array.isArray(v) && v.some(isModelParam)) return true;
      if (hasMarkers(v)) return true;
    }
    return false;
  }

  return hasMarkers(spec);
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function expandSpec(spec, backendPath, openapiDir) {
  const result = structuredClone(spec);
  delete result['x-enums'];
  const ctx = { backendPath, openapiDir };
  if (result.components?.schemas) result.components.schemas = await expandNode(result.components.schemas, ctx);
  if (result.paths)               result.paths               = await expandNode(result.paths, ctx);
  return result;
}
