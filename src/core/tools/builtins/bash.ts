// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {spawn, spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {performance} from 'node:perf_hooks'
import process from 'node:process'
import {z} from 'zod'

import type {ToolExecutionContext} from '../definition.js'

import {textToolResult} from '../definition.js'
import {defineBuiltinTool} from './factory.js'
import {DEFAULT_MAX_OUTPUT_BYTES, truncateText} from './shared.js'

const bashSchema = z.object({
  command: z.string().min(1),
  timeoutSeconds: z.number().positive().max(2_147_483).optional(),
})

export type BashToolInput = z.infer<typeof bashSchema>

interface ShellConfig {
  args: string[]
  shell: string
}

export function createBashTool() {
  return defineBuiltinTool({
    description: 'Execute a command with Bash in the current working directory.',
    async execute(input, context) {
      if (context.signal.aborted) throw new Error('Bash command aborted.')
      const shell = resolveShell()
      const startedAt = performance.now()
      const execution = await runCommand(shell, input, context)
      const output = execution.combined || `[command exited with code ${String(execution.exitCode)}]`
      const truncated = truncateText(output)
      const stdout = truncateText(execution.stdout)
      const stderr = truncateText(execution.stderr)
      return textToolResult(truncated.text, {
        details: {
          durationMs: performance.now() - startedAt,
          exitCode: execution.exitCode,
          shell: shell.shell,
          stderr: stderr.text,
          stdout: stdout.text,
          timedOut: execution.timedOut,
          truncated: execution.truncated || truncated.truncated || stdout.truncated || stderr.truncated,
        },
        isError: execution.timedOut,
      })
    },
    name: 'bash',
    scheduling: 'serial',
    schema: bashSchema,
  })
}

async function runCommand(
  shell: ShellConfig,
  input: BashToolInput,
  context: ToolExecutionContext,
): Promise<{
  combined: string
  exitCode: null | number
  stderr: string
  stdout: string
  timedOut: boolean
  truncated: boolean
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell.shell, [...shell.args, input.command], {
      cwd: context.cwd,
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let combined = ''
    let stderr = ''
    let stdout = ''
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    let truncated = false

    const append = (kind: 'stderr' | 'stdout', data: Buffer) => {
      const value = data.toString('utf8')
      const combinedCapture = appendCapture(combined, value)
      combined = combinedCapture.value
      truncated ||= combinedCapture.truncated
      if (kind === 'stdout') {
        const capture = appendCapture(stdout, value)
        stdout = capture.value
        truncated ||= capture.truncated
      } else {
        const capture = appendCapture(stderr, value)
        stderr = capture.value
        truncated ||= capture.truncated
      }

      context.emitUpdate(textToolResult(truncateText(value).text, {details: {stream: kind}}))
    }

    const abort = () => killProcessTree(child.pid)
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      context.signal.removeEventListener('abort', abort)
    }

    child.stdout?.on('data', (data: Buffer) => append('stdout', data))
    child.stderr?.on('data', (data: Buffer) => append('stderr', data))
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('close', (exitCode) => {
      cleanup()
      if (context.signal.aborted) {
        reject(new Error('Bash command aborted.'))
        return
      }

      resolve({combined, exitCode, stderr, stdout, timedOut, truncated})
    })
    context.signal.addEventListener('abort', abort, {once: true})
    if (input.timeoutSeconds !== undefined) {
      timer = setTimeout(() => {
        timedOut = true
        killProcessTree(child.pid)
      }, input.timeoutSeconds * 1000)
    }
  })
}

function appendCapture(current: string, chunk: string): {truncated: boolean; value: string} {
  if (Buffer.byteLength(current) >= DEFAULT_MAX_OUTPUT_BYTES) return {truncated: true, value: current}
  const appended = truncateText(`${current}${chunk}`)
  return {truncated: appended.truncated, value: appended.text}
}

function resolveShell(): ShellConfig {
  if (process.platform !== 'win32') {
    if (fs.existsSync('/bin/bash')) return {args: ['-c'], shell: '/bin/bash'}
    const bash = findOnPath('bash')
    return bash === undefined ? {args: ['-c'], shell: 'sh'} : {args: ['-c'], shell: bash}
  }

  const configured = process.env.ORBIT_BASH_PATH
  if (configured !== undefined) {
    if (!fs.existsSync(configured)) throw new Error(`Configured Bash shell does not exist: ${configured}`)
    return {args: ['-c'], shell: configured}
  }

  const candidates = [
    process.env.ProgramFiles === undefined ? undefined : path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] === undefined
      ? undefined
      : path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    findOnPath('bash.exe'),
  ]
  const shell = candidates.find((candidate): candidate is string => candidate !== undefined && fs.existsSync(candidate))
  if (shell === undefined) {
    throw new Error('No Bash shell found. Install Git Bash or set ORBIT_BASH_PATH.')
  }

  return {args: ['-c'], shell}
}

function findOnPath(command: string): string | undefined {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(finder, [command], {encoding: 'utf8', timeout: 5000, windowsHide: true})
  if (result.status !== 0 || !result.stdout) return undefined
  return result.stdout.trim().split(/\r?\n/u)[0] || undefined
}

function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {stdio: 'ignore', windowsHide: true})
    return
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // The process has already exited.
    }
  }
}
