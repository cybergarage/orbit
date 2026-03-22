// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

const TEMPLATE_PATTERN = /{([A-Za-z0-9_]+)}/g

export type PromptTemplateInput = Record<string, bigint | boolean | null | number | string | undefined>

export class PromptTemplate {
  private constructor(private readonly template: string) {}

  static from(template: string): PromptTemplate {
    return new PromptTemplate(template)
  }

  invoke(params: PromptTemplateInput): string {
    return this.template.replaceAll(TEMPLATE_PATTERN, (match, key: string) => {
      if (!(key in params)) {
        throw new Error(`Missing prompt template parameter: ${key}`)
      }

      const value = params[key]
      return value === null ? 'null' : String(value)
    })
  }
}
