// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {spawn} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {summarizeEvents} from './strategy.mjs'

export const repo = path.resolve(import.meta.dirname, '..')
export const image = process.env.ORBIT_E2E_IMAGE ?? 'orbit-e2e:local'
export const nodeImage = 'node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c'
export const activeContainers = new Set()
export async function command(
  exe,
  args,
  {allowFailure = false, cwd = repo, env = process.env, input, log, timeoutMs = 60_000} = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {cwd, env, stdio: ['pipe', 'pipe', 'pipe']})
    let stderr = ''
    let stdout = ''
    let timedOut = false
    const startedAt = Date.now()
    let timeoutObservedAt

    const timer = setTimeout(() => {
      timedOut = true
      timeoutObservedAt = Date.now()
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (data) => {
      stdout += data
      if (stdout.length > 16 * 1024 * 1024) child.kill('SIGKILL')
    })
    child.stderr.on('data', (data) => {
      stderr += data
      if (stderr.length > 16 * 1024 * 1024) child.kill('SIGKILL')
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', async (code) => {
      clearTimeout(timer)
      const result = {
        code,
        elapsedMs: Date.now() - startedAt,
        stderr,
        stdout,
        timedOut,
        timeoutMs,
        timeoutOverrunMs:
          timeoutObservedAt === undefined ? null : Math.max(0, timeoutObservedAt - startedAt - timeoutMs),
      }
      try {
        if (log) await fs.writeFile(log, stdout + stderr)
        if (!allowFailure && (code !== 0 || timedOut))
          throw new Error(`${exe} failed (${code}, timeout=${timedOut}): ${stderr.slice(-2000)}`)
        resolve(result)
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

export const docker = (args, options) => command('docker', args, options)
export const writeJSON = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n')
export const digest = (data) => createHash('sha256').update(data).digest('hex')

export async function cleanup() {
  for (const name of activeContainers) {
    await docker(['rm', '-f', name], {allowFailure: true}).catch(() => {})
    activeContainers.delete(name)
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await cleanup()
    // eslint-disable-next-line n/no-process-exit -- signal shutdown after container cleanup
    process.exit(130)
  })
}

export async function ollamaMetadata(model) {
  const host = process.env.OLLAMA_HOST_URL ?? 'http://127.0.0.1:11434'
  const call = async (route, body) => {
    const response = await fetch(host + route, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {'Content-Type': 'application/json'},
      method: body ? 'POST' : 'GET',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Ollama ${route}: ${response.status} ${await response.text()}`)
    return response.json()
  }

  const tags = await call('/api/tags')
  const installed = tags.models.find((item) => item.name === model)
  if (!installed) throw new Error(`Install the explicitly selected model first: ${model}`)
  const show = await call('/api/show', {model})
  return {
    capabilities: show.capabilities,
    details: show.details,
    digest: installed.digest,
    model,
    ollama: await call('/api/version'),
    parameters: show.parameters,
    size: installed.size,
    templateSha256: digest(show.template ?? ''),
  }
}

export async function runAgent({
  directory,
  files,
  model,
  numCtx = 16_384,
  prompt,
  rounds = 12,
  strategy = 'baseline',
  think = false,
  timeoutMs = 240_000,
  workspace,
}) {
  await fs.mkdir(directory, {recursive: true})
  const input = path.join(directory, 'input')
  await fs.mkdir(input)
  const config = {
    model,
    ollamaHost: process.env.ORBIT_E2E_OLLAMA_HOST ?? 'http://host.docker.internal:11434',
    options: {num_ctx: numCtx, num_predict: 4096, seed: 42, temperature: 0.6, top_p: 0.95},
    prompt,
    promptSha256: digest(prompt),
    rounds,
    strategy,
    think,
    timeoutMs,
  }
  await writeJSON(path.join(input, 'config.json'), config)
  const initial = path.join(directory, 'initial')
  await fs.mkdir(initial)
  if (workspace) await fs.cp(workspace, initial, {recursive: true})
  else
    for (const [name, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(initial, name)), {recursive: true})
      await fs.writeFile(path.join(initial, name), text)
    }

  const name = `orbit-e2e-${randomUUID()}`
  activeContainers.add(name)
  const start = Date.now()
  let error
  let events = []
  let execution
  let result
  let stage = 'environment'
  try {
    await docker([
      'create',
      '--name',
      name,
      '--init',
      '--env',
      'PYTHONDONTWRITEBYTECODE=1',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      '256',
      '--memory',
      '4g',
      '--cpus',
      '2',
      '--mount',
      `type=bind,src=${input},dst=/input,readonly`,
      '--mount',
      `type=bind,src=${initial},dst=/fixture,readonly`,
      image,
    ])
    stage = 'runtime'
    execution = await docker(['start', '-a', name], {
      allowFailure: true,
      log: path.join(directory, 'console.log'),
      timeoutMs: timeoutMs + 30_000,
    })
    await docker(['stop', '--time', '5', name], {allowFailure: true})
    const state = JSON.parse((await docker(['inspect', name])).stdout)[0]
    await writeJSON(path.join(directory, 'container.json'), state.State)
    await docker(['cp', `${name}:/output`, path.join(directory, 'output')])
    await docker(['cp', `${name}:/workspace`, path.join(directory, 'workspace')])
    result = JSON.parse(await fs.readFile(path.join(directory, 'output/result.json'), 'utf8'))
    events = (await fs.readFile(path.join(directory, 'output/events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (error_) {
    error = String(error_)
  } finally {
    const removed = await docker(['rm', '-f', name], {allowFailure: true})
    if (removed.code === 0) {
      activeContainers.delete(name)
    } else {
      error = `${error ?? ''} Cleanup failed: ${removed.stderr}`
    }
  }

  const usage = {inputTokens: 0, outputTokens: 0}
  for (const event of events)
    if (event.type === 'model.response.completed') {
      usage.inputTokens += event.data.usage?.inputTokens ?? 0
      usage.outputTokens += event.data.usage?.outputTokens ?? 0
    }

  const status = error
    ? `${stage}-error`
    : execution.timedOut
      ? 'timeout'
      : execution.code !== 0 || result.error || result.closeError || result.runtime?.outcome !== 'completed'
        ? 'runtime-error'
        : 'completed'
  const record = {
    config,
    elapsedMs: Date.now() - start,
    error,
    execution,
    metrics: summarizeEvents(events),
    model,
    result,
    status,
    usage,
    usageComplete: status === 'completed',
  }
  await writeJSON(path.join(directory, 'run.json'), record)
  return {...record, events}
}

export async function gradeWorkspace(directory, grader) {
  const marker = `ORBIT-GRADE-${randomUUID()}`
  const name = `orbit-grade-${randomUUID()}`
  activeContainers.add(name)
  try {
    const result = await docker(
      [
        'run',
        '--rm',
        '--name',
        name,
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--memory',
        '256m',
        '--cpus',
        '1',
        '--pids-limit',
        '32',
        '--mount',
        `type=bind,src=${path.join(directory, 'workspace')},dst=/workspace,readonly`,
        '-i',
        nodeImage,
        'node',
        '-',
      ],
      {
        allowFailure: true,
        input:
          "const assert=require('node:assert/strict'); const emit=console.log.bind(console);\n" +
          grader +
          `\nemit(${JSON.stringify(marker)});\n`,
        log: path.join(directory, 'grade.log'),
        timeoutMs: 30_000,
      },
    )
    return {...result, markerObserved: result.stdout.split('\n').includes(marker)}
  } finally {
    await docker(['rm', '-f', name], {allowFailure: true})
    activeContainers.delete(name)
  }
}
