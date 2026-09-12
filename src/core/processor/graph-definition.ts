// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'

import type {JsonSchema, ToolSource} from '../tools/definition.js'

import {canonicalJSON} from '../execution/journal.js'
import {createSchemaValidator, validateSchemaKeywords} from '../tools/schema.js'

export type GraphJSON = boolean | GraphJSON[] | null | number | string | {[key: string]: GraphJSON}
export interface GraphProfile {
  descriptorBytes: number
  maxEdges: number
  maxNodes: number
  maxNodeVisits: number
  valueBytes: number
}
export const DEFAULT_GRAPH_PROFILE: Readonly<GraphProfile> = Object.freeze({
  descriptorBytes: 262_144,
  maxEdges: 128,
  maxNodes: 64,
  maxNodeVisits: 128,
  valueBytes: 65_536,
})
export interface GraphAdapter {
  id: string
  inputSchema: JsonSchema
  /** Only trusted cooperative transform/router implementations receive this callback. */
  invoke?: (
    input: GraphJSON,
    configuration: GraphJSON,
    options: {signal: AbortSignal},
  ) => GraphJSON | Promise<GraphJSON>
  kind: 'agent' | 'router' | 'tool' | 'transform'
  outputSchema: JsonSchema
  tool?: {name: string; source: ToolSource}
  version: string
}
export interface GraphDefinition {
  edges: {from: string; id: string; label?: string; to: string}[]
  entry: string
  id: string
  nodes: {adapter: string; configuration?: GraphJSON; id: string}[]
  terminals: {id: string; outcome: 'completed' | 'failed'}[]
}
export interface GraphNode extends Omit<GraphAdapter, 'id' | 'invoke'> {
  adapter: string
  id: string
}
export interface GraphDescriptor extends Omit<GraphDefinition, 'nodes'> {
  nodes: GraphNode[]
  revision: 1
}
interface GraphBinding {
  configuration: GraphJSON
  input: (value: unknown) => {valid: boolean}
  invoke?: GraphAdapter['invoke']
  output: (value: unknown) => {valid: boolean}
}
const bindings = new WeakMap<CompiledProcessorGraph, Map<string, GraphBinding>>()
/** Immutable compiled definitions carry trusted callback references, never executable serialized code. */
export class CompiledProcessorGraph {
  private constructor(
    readonly descriptor: GraphDescriptor,
    readonly identity: string,
    readonly profile: Readonly<GraphProfile>,
    readonly configuration: Readonly<Record<string, GraphJSON>>,
  ) {}

  static async compile(
    definition: GraphDefinition,
    adapters: readonly GraphAdapter[],
    limits: Partial<GraphProfile> = {},
  ): Promise<CompiledProcessorGraph> {
    const profile = graphProfile(limits)
    const input = boundedGraphJSON(definition, profile.descriptorBytes) as unknown as GraphDefinition
    keys(input, ['id', 'entry', 'nodes', 'edges', 'terminals'])
    if (
      !Array.isArray(input.nodes) ||
      !Array.isArray(input.edges) ||
      !Array.isArray(input.terminals) ||
      !Array.isArray(adapters)
    )
      throw new Error('Invalid graph collections')
    const registry = new Map<string, GraphAdapter>()
    for (const adapter of adapters) {
      keys(adapter, ['id', 'version', 'kind', 'inputSchema', 'outputSchema', 'tool', 'invoke'])
      identity(adapter.id)
      versionIdentity(adapter.version)
      if (registry.has(adapter.id)) throw new Error('Duplicate graph adapter')
      if (
        ['router', 'transform'].includes(adapter.kind)
          ? typeof adapter.invoke !== 'function'
          : adapter.invoke !== undefined
      )
        throw new Error('Invalid graph callback capability')
      registry.set(adapter.id, {
        ...adapter,
        inputSchema: boundedGraphJSON(adapter.inputSchema, profile.descriptorBytes) as JsonSchema,
        outputSchema: boundedGraphJSON(adapter.outputSchema, profile.descriptorBytes) as JsonSchema,
        ...(adapter.tool
          ? {tool: boundedGraphJSON(adapter.tool, profile.descriptorBytes) as unknown as GraphAdapter['tool']}
          : {}),
      })
    }

    const privateConfig: Record<string, GraphJSON> = Object.create(null)
    const descriptor: GraphDescriptor = {
      ...input,
      nodes: input.nodes.map((node) => {
        keys(node, ['id', 'adapter', 'configuration'])
        const adapter = registry.get(node.adapter)
        if (!adapter) throw new Error('Unknown graph adapter')
        identity(node.id)
        privateConfig[node.id] = node.configuration ?? null
        if (adapter.kind === 'agent' && node.configuration !== null && node.configuration !== undefined) {
          keys(node.configuration, ['instruction', 'maxToolIterations'])
          const config = node.configuration as {instruction?: unknown; maxToolIterations?: unknown}
          if (config.instruction !== undefined && typeof config.instruction !== 'string')
            throw new Error('Invalid Agent instruction')
          if (
            config.maxToolIterations !== undefined &&
            (!Number.isSafeInteger(config.maxToolIterations) || Number(config.maxToolIterations) < 0)
          )
            throw new Error('Invalid Agent iteration limit')
        }

        return {
          adapter: adapter.id,
          id: node.id,
          inputSchema: adapter.inputSchema,
          kind: adapter.kind,
          outputSchema: adapter.outputSchema,
          version: adapter.version,
          ...(adapter.tool ? {tool: adapter.tool} : {}),
        }
      }),
      revision: 1,
    }
    descriptor.nodes.sort((a, b) => a.id.localeCompare(b.id, 'en'))
    descriptor.edges.sort((a, b) => a.id.localeCompare(b.id, 'en'))
    descriptor.terminals.sort((a, b) => a.id.localeCompare(b.id, 'en'))
    validateGraphDescriptor(descriptor, profile)
    const graph = new CompiledProcessorGraph(
      deepFreeze(descriptor),
      graphIdentity(descriptor),
      Object.freeze(profile),
      deepFreeze(privateConfig),
    )
    const resolved = new Map<string, GraphBinding>()
    for (const node of descriptor.nodes) {
      // Schema compilation is local and finishes before publishing the compiled definition.
      // eslint-disable-next-line no-await-in-loop
      const [inputValidator, outputValidator] = await Promise.all([
        createSchemaValidator(graphSchema(node.inputSchema)),
        createSchemaValidator(graphSchema(node.outputSchema)),
      ])
      resolved.set(node.id, {
        configuration: privateConfig[node.id],
        input: inputValidator,
        invoke: registry.get(node.adapter)!.invoke,
        output: outputValidator,
      })
    }

    bindings.set(graph, resolved)
    return Object.freeze(graph)
  }
}
export function compileProcessorGraph(
  definition: GraphDefinition,
  adapters: readonly GraphAdapter[],
  profile: Partial<GraphProfile> = {},
): Promise<CompiledProcessorGraph> {
  return CompiledProcessorGraph.compile(definition, adapters, profile)
}

/** Internal lookup verifies that the object came from the compiler, not a forged descriptor. */
export function graphBinding(graph: CompiledProcessorGraph, nodeId: string): GraphBinding {
  const binding = bindings.get(graph)?.get(nodeId)
  if (!binding) throw new Error('Unrecognized compiled graph or node')
  return binding
}

export function graphIdentity(descriptor: GraphDescriptor): string {
  return createHash('sha256').update(canonicalJSON(descriptor)).digest('hex')
}

export function graphProfile(limits: Partial<GraphProfile>): GraphProfile {
  keys(limits, Object.keys(DEFAULT_GRAPH_PROFILE))
  const profile = {...DEFAULT_GRAPH_PROFILE, ...limits}
  for (const value of Object.values(profile))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid finite graph limit')
  return profile
}

export function validateGraphDescriptor(value: GraphDescriptor, profile: GraphProfile): void {
  boundedGraphJSON(value, profile.descriptorBytes)
  keys(value, ['revision', 'id', 'entry', 'nodes', 'edges', 'terminals'])
  if (
    value.revision !== 1 ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !Array.isArray(value.terminals)
  )
    throw new Error('Invalid graph descriptor revision')
  identity(value.id)
  identity(value.entry)
  if (
    value.nodes.length === 0 ||
    value.terminals.length === 0 ||
    value.nodes.length > profile.maxNodes ||
    value.edges.length > profile.maxEdges ||
    value.terminals.length > profile.maxNodes
  )
    throw new Error('Graph definition exceeds limits')
  const nodes = new Map<string, GraphNode>()
  const terminals = new Set<string>()
  const edgeIds = new Set<string>()
  for (const node of value.nodes) {
    keys(node, ['id', 'adapter', 'version', 'kind', 'inputSchema', 'outputSchema', 'tool'])
    identity(node.id)
    identity(node.adapter)
    versionIdentity(node.version)
    if (nodes.has(node.id) || !['agent', 'router', 'tool', 'transform'].includes(node.kind))
      throw new Error('Invalid graph node')
    graphSchema(node.inputSchema)
    graphSchema(node.outputSchema)
    if ((node.kind === 'tool') !== Boolean(node.tool)) throw new Error('Invalid managed tool binding')
    if (node.tool) {
      keys(node.tool, ['name', 'source'])
      if (typeof node.tool.name !== 'string' || !node.tool.name || !node.tool.source)
        throw new Error('Invalid tool source')
      const {source} = node.tool
      switch (source.kind) {
        case 'builtin': {
          keys(source, ['kind'])
          break
        }

        case 'custom': {
          keys(source, ['kind', 'id'])
          identity(source.id)

          break
        }

        case 'mcp': {
          keys(source, ['kind', 'server', 'tool'])
          identity(source.server)
          if (source.tool !== undefined && (typeof source.tool !== 'string' || !source.tool))
            throw new Error('Invalid MCP tool source')

          break
        }

        default: {
          throw new Error('Unknown graph tool source')
        }
      }
    }

    nodes.set(node.id, node)
  }

  for (const terminal of value.terminals) {
    keys(terminal, ['id', 'outcome'])
    identity(terminal.id)
    if (nodes.has(terminal.id) || terminals.has(terminal.id) || !['completed', 'failed'].includes(terminal.outcome))
      throw new Error('Invalid graph terminal')
    terminals.add(terminal.id)
  }

  if (!nodes.has(value.entry)) throw new Error('Graph entry must name a node')
  for (const edge of value.edges) {
    keys(edge, ['id', 'from', 'to', 'label'])
    identity(edge.id)
    if (edgeIds.has(edge.id) || !nodes.has(edge.from) || (!nodes.has(edge.to) && !terminals.has(edge.to)))
      throw new Error('Invalid graph edge')
    edgeIds.add(edge.id)
    const source = nodes.get(edge.from)!
    const target = nodes.get(edge.to)
    if (source.kind === 'router') identity(edge.label!)
    else if (edge.label !== undefined) throw new Error('Only routers select labels')
    if (target && canonicalJSON(source.outputSchema) !== canonicalJSON(target.inputSchema))
      throw new Error('Graph schema connection mismatch')
  }

  for (const node of nodes.values()) {
    const edges = value.edges.filter((edge) => edge.from === node.id)
    if (node.kind === 'router') {
      if (
        edges.length === 0 ||
        new Set(edges.map((edge) => edge.label)).size !== edges.length ||
        canonicalJSON(node.inputSchema) !== canonicalJSON(node.outputSchema)
      )
        throw new Error('Invalid graph router routes')
    } else if (edges.length !== 1) throw new Error('Work nodes require one successor')
  }

  const reachable = (starts: string[], reverse = false) => {
    const seen = new Set(starts)
    const queue = [...starts]
    for (let i = 0; i < queue.length; i++)
      for (const edge of value.edges) {
        const from = reverse ? edge.to : edge.from
        const to = reverse ? edge.from : edge.to
        if (queue[i] === from && !seen.has(to)) {
          seen.add(to)
          queue.push(to)
        }
      }

    return seen
  }

  const forward = reachable([value.entry])
  const backward = reachable([...terminals], true)
  if (
    [...nodes.keys(), ...terminals].some((id) => !forward.has(id)) ||
    [...nodes.keys()].some((id) => !backward.has(id))
  )
    throw new Error('Unreachable graph node or terminal')
}

export function boundedGraphJSON(value: unknown, bytes: number): GraphJSON {
  const visit = (item: unknown, depth: number, seen: Set<object>): void => {
    if (depth > 32) throw new Error('Graph JSON nesting exceeds limit')
    if (typeof item !== 'object' || item === null) {
      if (
        item === null ||
        ['boolean', 'string'].includes(typeof item) ||
        (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0))
      )
        return
      throw new Error('Invalid graph JSON value')
    }

    if (seen.has(item) || (!Array.isArray(item) && ![null, Object.prototype].includes(Object.getPrototypeOf(item))))
      throw new Error('Graph values require plain acyclic JSON')
    seen.add(item)
    if (Object.getOwnPropertySymbols(item).length > 0) throw new Error('Symbol graph fields are unsupported')
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue
      if (!('value' in desc) || !desc.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('Unsafe graph JSON field')
      visit(desc.value, depth + 1, seen)
    }

    if (Array.isArray(item) && Object.keys(item).length !== item.length)
      throw new Error('Sparse graph arrays are unsupported')
    seen.delete(item)
  }

  visit(value, 0, new Set())
  const encoded = canonicalJSON(value)
  if (Buffer.byteLength(encoded) > bytes) throw new Error('Graph JSON exceeds byte limit')
  return JSON.parse(encoded) as GraphJSON
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }

  return value
}

function identity(value: string): void {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{1,160}$/u.test(value) ||
    ['__proto__', 'constructor', 'deletions', 'prototype'].includes(value)
  )
    throw new Error('Invalid graph identity')
}

function keys(value: unknown, allowed: string[]): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error('Unknown graph field')
}

function versionIdentity(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,160}$/u.test(value))
    throw new Error('Invalid graph adapter version')
}

// This closed vocabulary has the same semantics in draft-07 and the emitted
// 2020-12 builtin schemas. No references, tuple items or unevaluated keywords.
function graphSchema(schema: JsonSchema): JsonSchema {
  const result = {...schema}
  if (
    result.$schema !== undefined &&
    !['http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft/2020-12/schema'].includes(
      String(result.$schema),
    )
  )
    throw new Error('Unsupported Graph schema dialect')
  delete result.$schema
  const rejectTuple = (item: unknown): void => {
    if (!item || typeof item !== 'object') return
    if (Array.isArray((item as {items?: unknown}).items)) throw new Error('Graph tuple schema is unsupported')
    for (const child of Object.values(item)) rejectTuple(child)
  }

  rejectTuple(result)
  validateSchemaKeywords(result, true, ['exclusiveMinimum', 'exclusiveMaximum'])
  validateSchemaShape(result)
  return result
}

const record = (value: unknown): value is JsonSchema =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') && new Set(value).size === value.length

// Reader-side structural validation cannot execute adapters or resolve schemas.
function validateSchemaShape(schema: JsonSchema): void {
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type') {
      const types = typeof value === 'string' ? [value] : value
      if (
        !strings(types) ||
        types.length === 0 ||
        types.some((type) => !['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'].includes(type))
      )
        throw new Error('Invalid Graph schema type')
    } else if (key === 'properties') {
      if (!record(value)) throw new Error('Invalid Graph schema properties')
      for (const child of Object.values(value)) {
        if (!record(child)) throw new Error('Invalid Graph property schema')
        validateSchemaShape(child)
      }
    } else if (['allOf', 'anyOf', 'oneOf'].includes(key)) {
      if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid Graph schema alternatives')
      for (const child of value) {
        if (!record(child)) throw new Error('Invalid Graph schema alternative')
        validateSchemaShape(child)
      }
    } else if (['additionalProperties', 'items', 'not'].includes(key)) {
      if (key === 'additionalProperties' && typeof value === 'boolean') continue
      if (!record(value)) throw new Error('Invalid Graph nested schema')
      validateSchemaShape(value)
    } else if (key === 'required') {
      if (!strings(value)) throw new Error('Invalid Graph schema required fields')
    } else if (['exclusiveMaximum', 'exclusiveMinimum', 'maximum', 'minimum'].includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid Graph numeric bound')
    } else if (['maxItems', 'maxLength', 'minItems', 'minLength'].includes(key)) {
      if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid Graph length bound')
    } else if (['description', 'format', 'pattern', 'title'].includes(key)) {
      if (typeof value !== 'string') throw new Error('Invalid Graph schema annotation')
      // Compile syntax without evaluating any input or invoking a host adapter.
      // eslint-disable-next-line no-new
      if (key === 'pattern') new RegExp(value, 'u')
    } else if (
      key === 'enum' &&
      (!Array.isArray(value) ||
        value.length === 0 ||
        new Set(value.map((item) => canonicalJSON(item))).size !== value.length)
    )
      throw new Error('Invalid Graph schema enumeration')
  }
}
