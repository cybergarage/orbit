// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// The initial managed MCP profile rejects unsupported schema vocabulary instead of silently ignoring it.
export function validateSchemaKeywords(
  schema: Record<string, unknown>,
  root = true,
  additionalKeywords: readonly string[] = [],
): void {
  const supported = new Set([
    '$schema',
    'additionalProperties',
    'allOf',
    'anyOf',
    'const',
    'default',
    'description',
    'enum',
    'format',
    'items',
    'maximum',
    'maxItems',
    'maxLength',
    'minimum',
    'minItems',
    'minLength',
    'not',
    'oneOf',
    'pattern',
    'properties',
    'required',
    'title',
    'type',
    ...additionalKeywords,
  ])
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema' && (!root || value !== 'http://json-schema.org/draft-07/schema#'))
      throw new Error('Unsupported managed MCP schema declaration')
    if (key === 'format' && value !== 'uri') throw new Error('Unsupported managed MCP schema format')
    if (!supported.has(key)) throw new Error(`Unsupported managed MCP schema keyword: ${key}`)
    if (key === 'properties' && isRecord(value))
      for (const child of Object.values(value)) {
        if (!isRecord(child)) throw new Error('Invalid property schema')
        validateSchemaKeywords(child, false, additionalKeywords)
      }

    if (['additionalProperties', 'items', 'not'].includes(key) && isRecord(value))
      validateSchemaKeywords(value, false, additionalKeywords)
    if (['allOf', 'anyOf', 'items', 'oneOf'].includes(key) && Array.isArray(value))
      for (const child of value) {
        if (!isRecord(child)) throw new Error('Invalid schema alternative')
        validateSchemaKeywords(child, false, additionalKeywords)
      }
  }
}

export async function createSchemaValidator(
  schema: Record<string, unknown>,
): Promise<(input: unknown) => {valid: boolean}> {
  // SDK 1.29's exported AJV declaration has a Node16 namespace/type incompatibility.
  // Keep a narrow runtime facade instead of disabling library checks globally.
  const providerModule = '@modelcontextprotocol/sdk/validation/ajv'
  const provider = (await import(providerModule)) as {
    AjvJsonSchemaValidator: new () => {
      getValidator(schema: Record<string, unknown>): (input: unknown) => {valid: boolean}
    }
  }
  return new provider.AjvJsonSchemaValidator().getValidator(schema)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
