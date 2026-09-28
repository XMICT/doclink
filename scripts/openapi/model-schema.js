import { introspectSchema } from './introspect.js';

// Normaliza una entrada de `fields` al formato { field, alias }.
// "campo"          → { field: "campo", alias: "campo" }
// ["campo", "as"]  → { field: "campo", alias: "as"   }
export function parseField(entry) {
  return Array.isArray(entry)
    ? { field: entry[0], alias: entry[1] }
    : { field: entry,    alias: entry    };
}

// `exclude` puede ser una lista de campos o la palabra clave "virtuals".
export function resolveExclude(exclude, virtuals = []) {
  if (exclude === 'virtuals') return new Set(virtuals);
  if (Array.isArray(exclude)) return new Set(exclude);
  return new Set();
}

// `fields` puede ser una lista (strings o [field, alias]), o estar ausente (→ todos).
// Devuelve { field, alias }[] filtrando por ownProperties y excludeSet.
export function resolveFields(fields, ownProperties, excludeSet) {
  const all  = Object.keys(ownProperties).map(f => ({ field: f, alias: f }));
  const base = Array.isArray(fields) && fields.length ? fields.map(parseField) : all;
  return base.filter(({ field }) => ownProperties[field] && !excludeSet.has(field));
}

// Construye las propiedades de asociación a partir de un `include`.
// Cada entrada es un alias (string) o `{ model: alias, fields: [...] }`.
export async function buildAssocSchema(include, schemaData, ctx) {
  const assocSchema = {};
  for (const raw of include) {
    const alias  = typeof raw === 'string' ? raw : raw.model;
    const fields = typeof raw === 'object' ? (raw.fields ?? null) : null;

    const assocRef = schemaData?.assocProperties?.[alias];
    if (!assocRef) continue;
    const targetModelName = assocRef['$ref']?.split('/').pop();
    if (!targetModelName) continue;

    try {
      const target  = await introspectSchema(targetModelName, ctx.backendPath);
      if (target.warnings?.length) ctx.warnings.push(...target.warnings);
      const entries = fields
        ? fields.map(parseField)
        : Object.keys(target.ownProperties).map(f => ({ field: f, alias: f }));
      const props = Object.fromEntries(
        entries
          .filter(({ field }) => target.ownProperties[field])
          .map(({ field, alias: fieldAlias }) => [fieldAlias, { ...target.ownProperties[field] }])
      );
      assocSchema[alias] = { type: 'object', properties: props };
    } catch { /* modelo no encontrado, se omite la asociación */ }
  }
  return assocSchema;
}

// `type: model` → schema inline: campos propios primero, asociaciones al final.
export async function expandModelSchema(node, ctx) {
  const { include = [], model, exclude, description, example } = node;
  const schemaData  = await introspectSchema(model, ctx.backendPath);
  if (schemaData.warnings?.length) ctx.warnings.push(...schemaData.warnings);
  const excludeSet  = resolveExclude(exclude, schemaData.virtuals ?? []);

  const properties = Object.fromEntries(
    Object.entries(schemaData.ownProperties ?? {})
      .filter(([k]) => !excludeSet.has(k))
      .map(([k, v]) => [k, { ...v }])
  );
  Object.assign(properties, await buildAssocSchema(include, schemaData, ctx));

  const required = (schemaData.required ?? []).filter(f => !excludeSet.has(f) && properties[f]);
  return {
    type: 'object',
    properties,
    ...(required.length     ? { required }     : {}),
    ...(description         ? { description }  : {}),
    ...(example !== undefined ? { example }    : {}),
  };
}

// `{ model, fields: [campo] }` sin `type` → schema del campo individual del modelo.
export async function expandFieldSchema(node, ctx) {
  const { field } = parseField(node.fields[0]);
  const schemaData = await introspectSchema(node.model, ctx.backendPath);
  if (schemaData.warnings?.length) ctx.warnings.push(...schemaData.warnings);
  const prop = schemaData.ownProperties[field];
  return prop ? { ...prop } : { type: 'string' };
}

// Entrada `{ model, fields, exclude, in? }` en `parameters` → params del modelo.
// in:"path" → required:true, sin body_filtro.
// in:"query" (default) → query params + body_filtro.
export async function buildModelParams(entry, ctx) {
  const schemaData = await introspectSchema(entry.model, ctx.backendPath);
  if (schemaData.warnings?.length) ctx.warnings.push(...schemaData.warnings);
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
