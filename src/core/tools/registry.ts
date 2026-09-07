// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ModelToolCall} from '../models/model.js'
import type {ToolDefinition, ToolExecutionContext, ToolResult} from './definition.js'

import {copyJSON} from '../execution/journal.js'

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u

export interface ToolExecutionResult {
  result: ToolResult
  toolCall: ModelToolCall
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>()

  register(definition: ToolDefinition): void {
    const {name} = definition.spec
    if (!TOOL_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid tool name: ${name}`)
    }

    const existing = this.definitions.get(name)
    if (existing !== undefined) {
      throw new Error(
        `Duplicate tool name: ${name} (${formatSource(existing)} conflicts with ${formatSource(definition)})`,
      )
    }

    this.definitions.set(name, {
      ...definition,
      execute: definition.execute.bind(definition),
      input: {jsonSchema: copyJSON(definition.input.jsonSchema), parse: definition.input.parse.bind(definition.input)},
      source: copyJSON(definition.source),
      spec: copyJSON(definition.spec),
      ...(definition.prepare ? {prepare: definition.prepare.bind(definition)} : {}),
    })
  }

  snapshot(): ToolSnapshot {
    return new ToolSnapshot([...this.definitions.values()])
  }
}

export class ToolSnapshot {
  private readonly definitions: ReadonlyMap<string, ToolDefinition>

  constructor(definitions: ToolDefinition[]) {
    this.definitions = new Map(definitions.map((definition) => [definition.spec.name, definition]))
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name)
  }

  specs() {
    return [...this.definitions.values()].map((definition) => copyJSON(definition.spec))
  }
}

export class ToolRuntime {
  constructor(
    private readonly snapshot: ToolSnapshot,
    private readonly managedExecute?: (
      definition: ToolDefinition,
      input: unknown,
      context: ToolExecutionContext,
    ) => Promise<ToolResult>,
    private readonly onInvalid?: (toolCall: ModelToolCall) => Promise<void>,
  ) {}

  async executeAll(
    toolCalls: ModelToolCall[],
    createContext: (toolCall: ModelToolCall) => ToolExecutionContext,
    onExecute?: (toolCall: ModelToolCall, execute: () => Promise<ToolExecutionResult>) => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = []
    let parallelBatch: ModelToolCall[] = []

    const flushParallel = async () => {
      if (parallelBatch.length === 0) return
      results.push(
        ...(await settleBatch(parallelBatch.map((toolCall) => this.executeOne(toolCall, createContext, onExecute)))),
      )
      parallelBatch = []
    }

    for (const toolCall of toolCalls) {
      const definition = this.snapshot.get(toolCall.name)
      if (
        definition?.scheduling === 'parallel' &&
        (!this.managedExecute ||
          (definition.source.kind === 'builtin' && ['glob', 'grep', 'list', 'read'].includes(definition.spec.name)))
      ) {
        parallelBatch.push(toolCall)
        continue
      }

      // Serial calls form barriers so reads cannot race across a mutation.
      // eslint-disable-next-line no-await-in-loop
      await flushParallel()
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.executeOne(toolCall, createContext, onExecute))
    }

    await flushParallel()
    return results
  }

  private executeOne(
    toolCall: ModelToolCall,
    createContext: (toolCall: ModelToolCall) => ToolExecutionContext,
    onExecute?: (toolCall: ModelToolCall, execute: () => Promise<ToolExecutionResult>) => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    const execute = async (): Promise<ToolExecutionResult> => {
      const definition = this.snapshot.get(toolCall.name)
      if (definition === undefined) {
        await this.onInvalid?.(toolCall)
        return {
          result: {content: [{text: `Unknown tool: ${toolCall.name}`, type: 'text'}], isError: true},
          toolCall,
        }
      }

      try {
        const input = this.managedExecute ? toolCall.input : definition.input.parse(toolCall.input)
        const context = createContext(toolCall)
        const result = this.managedExecute
          ? await this.managedExecute(definition, input, context)
          : await definition.execute(input, context)
        return {result, toolCall}
      } catch (error) {
        if (this.managedExecute && createContext(toolCall).signal.aborted) throw error
        return {
          result: {
            content: [{text: error instanceof Error ? error.message : String(error), type: 'text'}],
            isError: true,
          },
          toolCall,
        }
      }
    }

    return onExecute === undefined ? execute() : onExecute(toolCall, execute)
  }
}

function formatSource(definition: ToolDefinition): string {
  if (definition.source.kind === 'builtin') return 'builtin'
  if (definition.source.kind === 'mcp') return `MCP server ${definition.source.server}`
  return `custom source ${definition.source.id}`
}

async function settleBatch(promises: Promise<ToolExecutionResult>[]): Promise<ToolExecutionResult[]> {
  const settled = await Promise.allSettled(promises)
  const failed = settled.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return settled.map((result) => (result as PromiseFulfilledResult<ToolExecutionResult>).value)
}
