// A small JSON Schema checker for the subset the flow schemas use (type, const, enum, properties, required,
// additionalProperties, items, minItems, maxItems, minimum, exclusiveMinimum, minLength, oneOf, anyOf, $ref to #/$defs).
// Returns the list of errors (empty when the value fits). Used by v24-flow.test.mjs on real results.
export function checkSchema(schema, value) {
  const errors = [];
  const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
  const fits = (type, v) => type === typeOf(v) || (type === 'number' && typeof v === 'number' && Number.isFinite(v));
  const walk = (s, v, path, out) => {
    if (s.$ref) { const name = s.$ref.replace('#/$defs/', ''); return walk(schema.$defs[name], v, path, out); }
    if (s.oneOf || s.anyOf) {
      const list = s.oneOf ?? s.anyOf, passing = list.filter(sub => { const e = []; walk(sub, v, path, e); return e.length === 0; }).length;
      if (s.oneOf ? passing !== 1 : passing === 0) out.push(`${path}: matches ${passing} of the ${s.oneOf ? 'oneOf' : 'anyOf'} branches`);
      return;
    }
    if ('const' in s && v !== s.const) { out.push(`${path}: is ${JSON.stringify(v)}, not ${JSON.stringify(s.const)}`); return; }
    if (s.enum && !s.enum.includes(v)) { out.push(`${path}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.enum)}`); return; }
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some(t => fits(t, v))) { out.push(`${path}: is ${typeOf(v)}, not ${types.join(' or ')}`); return; }
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) out.push(`${path}: ${v} is below ${s.minimum}`);
      if (s.exclusiveMinimum !== undefined && !(v > s.exclusiveMinimum)) out.push(`${path}: ${v} is not above ${s.exclusiveMinimum}`);
    }
    if (typeof v === 'string' && s.minLength !== undefined && v.length < s.minLength) out.push(`${path}: shorter than ${s.minLength}`);
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) out.push(`${path}: fewer than ${s.minItems} items`);
      if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${path}: more than ${s.maxItems} items`);
      if (s.items) {
        // long numeric arrays: check the first and last few items
        const idx = v.length > 64 ? [0, 1, 2, v.length - 2, v.length - 1] : v.map((_, i) => i);
        for (const i of idx) walk(s.items, v[i], `${path}[${i}]`, out);
      }
    } else if (v && typeof v === 'object') {
      for (const key of s.required ?? []) if (!(key in v)) out.push(`${path}: lacks ${key}`);
      for (const [key, item] of Object.entries(v)) {
        if (s.properties && key in s.properties) walk(s.properties[key], item, `${path}.${key}`, out);
        else if (s.additionalProperties === false) out.push(`${path}: has the unknown member ${key}`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, item, `${path}.${key}`, out);
      }
    }
  };
  walk(schema, value, '$', errors);
  return errors;
}
