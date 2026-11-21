// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {BashToolInput} from '../tools/builtins/bash.js'
import type {EditToolInput} from '../tools/builtins/edit.js'
import type {GlobToolInput} from '../tools/builtins/glob.js'
import type {GrepToolInput} from '../tools/builtins/grep.js'
import type {ListToolInput} from '../tools/builtins/list.js'
import type {ReadToolInput} from '../tools/builtins/read.js'
import type {WriteToolInput} from '../tools/builtins/write.js'
import type {ToolDefinition, ToolResult} from '../tools/definition.js'

import {copyJSON} from './journal.js'

interface WorkspaceInputs {
  bash: BashToolInput
  edit: EditToolInput
  glob: GlobToolInput
  grep: GrepToolInput
  list: ListToolInput
  read: ReadToolInput
  write: WriteToolInput
}

type Name = keyof WorkspaceInputs
type ReadonlyInput<T> = {
  readonly [K in keyof T]: T[K] extends infer V ? (V extends string[] ? readonly string[] : V) : never
}
type ExecutionDetails<N extends Name> = N extends 'bash'
  ? {readonly effect: 'command'}
  : N extends 'edit' | 'write'
    ? {readonly effect: 'write'; readonly preimageSha256: null | string; readonly resultSha256: string}
    : {readonly effect: 'read'}

/** Core-reviewed input in the host's canonical workspace namespace. */
export type PreparedWorkspaceOperation = {
  [N in Name]: ExecutionDetails<N> & {
    readonly cwd: string
    readonly input: ReadonlyInput<WorkspaceInputs[N]>
    readonly name: N
    readonly target: string
    readonly version: 1
  }
}[Name]

/** Host-owned, network-disabled command authority, not a tool input. */
export interface WorkspaceCommandProfile {
  readonly backend: string
  readonly id: string
  readonly maxResultBytes: number
  readonly network: 'none'
  /** Immutable backend artifact identity, not a mutable tag. */
  readonly revision: string
  readonly timeoutMs: number
  readonly workspace: 'read-only' | 'read-write'
}

export type PreparedWorkspaceCommand = Omit<Extract<PreparedWorkspaceOperation, {name: 'bash'}>, 'input'> & {
  readonly input: {readonly command: string; readonly timeoutSeconds: number}
  readonly profile: WorkspaceCommandProfile
  readonly timeoutMs: number
}

export type WorkspaceCommandOutcome =
  | {
      readonly exitCode: number
      readonly status: 'exited'
      readonly stderr: string
      readonly stdout: string
      readonly text: string
      readonly truncated?: boolean
    }
  | {readonly status: 'unknown'}

export interface WorkspaceCommandAdapter {
  /** Report an exited command only after the backend confirms its settlement. */
  execute(operation: PreparedWorkspaceCommand, signal: AbortSignal): Promise<WorkspaceCommandOutcome>
  readonly profile: WorkspaceCommandProfile
  /** Recheck authority and identity without starting a process or changing files. */
  revalidate(operation: PreparedWorkspaceCommand, signal: AbortSignal): boolean | Promise<boolean>
}

/** Trusted application dependency; this is not a sandbox, policy, or tool catalog. */
export interface WorkspaceExecutor {
  /** Requires explicit selection of bash; never selected by model input. */
  readonly command?: WorkspaceCommandAdapter
  execute(operation: PreparedWorkspaceOperation, signal: AbortSignal): Promise<ToolResult>
  /** Only these managed built-ins use this executor; omitted means all. */
  readonly toolNames?: readonly PreparedWorkspaceOperation['name'][]
}

export function captureWorkspaceExecutor(value: undefined | WorkspaceExecutor): undefined | WorkspaceExecutor {
  if (value === undefined) return undefined
  if (typeof value?.execute !== 'function') throw new Error('Invalid workspace executor')
  const selected = value.toolNames
  const {command} = value
  if (command !== undefined && (!Array.isArray(selected) || !selected.includes('bash')))
    throw new Error('Workspace command adapter requires explicit Bash selection')
  if (selected === undefined) return Object.freeze({execute: value.execute.bind(value)})
  if (!Array.isArray(selected)) throw new Error('Invalid workspace executor tool names')
  const toolNames = Object.freeze([...selected])
  if (toolNames.some((name) => !names.has(name)) || new Set(toolNames).size !== toolNames.length)
    throw new Error('Invalid workspace executor tool names')
  return Object.freeze({
    execute: value.execute.bind(value),
    toolNames,
    ...(command === undefined ? {} : {command: captureCommandAdapter(command)}),
  })
}

function profileIdentifier(value: unknown): boolean {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)
}

function captureCommandAdapter(adapter: WorkspaceCommandAdapter): WorkspaceCommandAdapter {
  const profile = adapter?.profile
  if (!profile || typeof adapter.execute !== 'function' || typeof adapter.revalidate !== 'function')
    throw new Error('Invalid workspace command adapter')
  const {backend, id, maxResultBytes, network, revision, timeoutMs, workspace} = profile
  if (
    !profileIdentifier(id) ||
    !profileIdentifier(backend) ||
    typeof revision !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(revision) ||
    network !== 'none' ||
    (workspace !== 'read-only' && workspace !== 'read-write') ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000 ||
    !Number.isSafeInteger(maxResultBytes) ||
    maxResultBytes < 256 ||
    maxResultBytes > MAX_BYTES
  )
    throw new Error('Invalid workspace command profile')
  return Object.freeze({
    execute: adapter.execute.bind(adapter),
    profile: Object.freeze({backend, id, maxResultBytes, network, revision, timeoutMs, workspace}),
    revalidate: adapter.revalidate.bind(adapter),
  })
}

export function prepareWorkspaceCommand(
  request: Extract<PreparedWorkspaceOperation, {name: 'bash'}>,
  profile: WorkspaceCommandProfile,
): PreparedWorkspaceCommand {
  const requested = request.input.timeoutSeconds
  const timeoutMs = requested === undefined ? profile.timeoutMs : Math.round(requested * 1000)
  if (
    request.cwd !== request.target ||
    (requested !== undefined && requested !== timeoutMs / 1000) ||
    timeoutMs < 1 ||
    timeoutMs > profile.timeoutMs ||
    request.input.command.includes('\0')
  )
    throw new Error('Workspace command exceeds its configured limits')
  const input = Object.freeze({command: request.input.command, timeoutSeconds: timeoutMs / 1000})
  return Object.freeze({...request, input, profile, timeoutMs})
}

export function workspaceCommandResult(outcome: WorkspaceCommandOutcome, profile: WorkspaceCommandProfile): ToolResult {
  if (
    outcome?.status !== 'exited' ||
    !Number.isSafeInteger(outcome.exitCode) ||
    outcome.exitCode < 0 ||
    outcome.exitCode > 255 ||
    typeof outcome.text !== 'string' ||
    typeof outcome.stdout !== 'string' ||
    typeof outcome.stderr !== 'string' ||
    (outcome.truncated !== undefined && typeof outcome.truncated !== 'boolean')
  )
    throw new Error('Workspace command outcome is unknown; do not replay')
  return boundWorkspaceResult(
    {
      content: [{text: outcome.text, type: 'text'}],
      details: {
        exitCode: outcome.exitCode,
        stderr: outcome.stderr,
        stdout: outcome.stdout,
        timedOut: false,
        truncated: outcome.truncated === true,
      },
      isError: outcome.exitCode !== 0,
    },
    profile.maxResultBytes,
  )
}

const names = new Set<string>(['bash', 'edit', 'glob', 'grep', 'list', 'read', 'write'])
const registered = new WeakMap<ToolDefinition, Name>()
const MAX_BYTES = 1024 * 1024

/** Runtime-only registration, not inferred from tool name, schema, or model input. */
export function markWorkspaceBuiltin(definition: ToolDefinition): void {
  if (names.has(definition.spec.name)) registered.set(definition, definition.spec.name as Name)
}

export function copyWorkspaceBuiltin(source: ToolDefinition, target: ToolDefinition): void {
  const name = registered.get(source)
  if (name !== undefined) registered.set(target, name)
}

export function isWorkspaceBuiltin(definition: ToolDefinition, toolNames?: WorkspaceExecutor['toolNames']): boolean {
  const name = registered.get(definition)
  return (
    name !== undefined &&
    name === definition.spec.name &&
    definition.source.kind === 'builtin' &&
    (toolNames === undefined || toolNames.includes(name))
  )
}

export function boundWorkspaceOperation(value: PreparedWorkspaceOperation): PreparedWorkspaceOperation {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw new Error('Workspace operation exceeds byte limit')
  return Object.freeze(value)
}

/** Detach trusted backend output before it is journaled or exposed to the model. */
export function boundWorkspaceResult(value: ToolResult, maxBytes = MAX_BYTES): ToolResult {
  const result = copyJSON(value)
  if (
    !Array.isArray(result.content) ||
    result.content.some((part) => part.type !== 'text' || typeof part.text !== 'string') ||
    (result.isError !== undefined && typeof result.isError !== 'boolean') ||
    Buffer.byteLength(JSON.stringify(result)) > maxBytes
  )
    throw new Error('Invalid workspace execution result')
  return result
}
