// ─── Conversor AJV → OpenAPI ──────────────────────────────────────────────────

export function convertAjvSchema(schema) {
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
      if (schema.required?.length)              result.required = schema.required;
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

export function convertJoiDescribe(desc) {
  if (!desc || typeof desc !== 'object') return { type: 'string' };

  const rules = desc.rules ?? [];
  const allow = desc.allow ?? [];

  const isNullable = allow.some(v => v === null);
  const applyNullable = schema => {
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
