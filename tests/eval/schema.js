import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../behavior-eval-output.schema.json', import.meta.url), 'utf8'));

function validateNode(value, definition, path, errors) {
  switch (definition.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path} must be an object`);
        return;
      }
      for (const required of definition.required ?? []) {
        if (!Object.hasOwn(value, required)) errors.push(`${path} is missing required property '${required}'`);
      }
      if (definition.additionalProperties === false) {
        for (const property of Object.keys(value)) {
          if (!Object.hasOwn(definition.properties, property)) errors.push(`${path} contains unexpected property '${property}'`);
        }
      }
      for (const [property, childSchema] of Object.entries(definition.properties ?? {})) {
        if (Object.hasOwn(value, property)) validateNode(value[property], childSchema, `${path}.${property}`, errors);
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${path} must be an array`);
        return;
      }
      value.forEach((item, index) => validateNode(item, definition.items, `${path}[${index}]`, errors));
      break;
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${path} must be a string`);
        return;
      }
      if (definition.minLength !== undefined && value.length < definition.minLength) {
        errors.push(`${path} must contain at least ${definition.minLength} characters`);
      }
      if (definition.pattern !== undefined && !(new RegExp(definition.pattern, 'u')).test(value)) {
        errors.push(`${path} must match pattern ${definition.pattern}`);
      }
      break;
    case 'integer':
      if (!Number.isInteger(value)) {
        errors.push(`${path} must be an integer`);
        return;
      }
      if (definition.minimum !== undefined && value < definition.minimum) {
        errors.push(`${path} must be at least ${definition.minimum}`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
      break;
    default:
      throw new Error(`Unsupported schema type: ${definition.type}`);
  }

  if (definition.enum && !definition.enum.includes(value)) {
    errors.push(`${path} must be one of: ${definition.enum.join(', ')}`);
  }
}

export function validateResponse(value) {
  const errors = [];
  validateNode(value, schema, '$', errors);
  return errors;
}
