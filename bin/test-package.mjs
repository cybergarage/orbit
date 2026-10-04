#!/usr/bin/env node
// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- cp is available on the minimum Node 20.19, though marked experimental there.
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = await mkdtemp(path.join(os.tmpdir(), 'orbit-package-'))
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this check with npm run test:package')
function runNpm(args, cwd, capture = false) {
  return execFileSync(process.execPath, [npm, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
}

try {
  const output = runNpm(['pack', '--json', '--pack-destination', temporary], root, true)
  // npm forwards lifecycle stdout before its JSON result.
  const start = output.search(/^\[\s*$/mu)
  assert.ok(start >= 0, 'npm pack did not return a JSON file list')
  const [packed] = JSON.parse(output.slice(start))
  assert.equal(packed.name, '@cybergarage/orbit')
  const files = new Set(packed.files.map((file) => file.path))
  for (const required of [
    'dist/index.js',
    'dist/index.d.ts',
    'native/apple-foundation-models/main.swift',
    'bin/test-apple-foundation-models.mjs',
    'dist/apps/gui/public/client.js',
    'bin/run.js',
    'bin/args.js',
    'oclif.manifest.json',
  ]) {
    assert.ok(files.has(required), `Missing package file: ${required}`)
  }

  for (const file of files) {
    assert.ok(
      !/(^|\/)(\.env(?:\..*)?|\.npmrc|\.git|node_modules)(\/|$)/u.test(file),
      `Unexpected package file: ${file}`,
    )
  }

  const consumer = path.join(temporary, 'consumer')
  await cp(path.join(root, 'examples/agent'), consumer, {
    filter: (source) => !['.agent', 'dist', 'node_modules', 'workspace'].includes(path.basename(source)),
    recursive: true,
  })
  const manifestPath = path.join(consumer, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.dependencies['@cybergarage/orbit'], packed.version, 'Example must pin the release version')
  manifest.dependencies['@cybergarage/orbit'] = `file:${path.join(temporary, packed.filename)}`
  // Match the repository's tested compiler and declarations for this consumer check.
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  for (const name of Object.keys(manifest.devDependencies)) {
    manifest.devDependencies[name] = lock.packages[`node_modules/${name}`].version
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer)
  runNpm(['rebuild', 'better-sqlite3'], consumer)
  await writeFile(
    path.join(consumer, 'src/execution-api-probe.ts'),
    `
import {OperationExecutor, executeManagedTool, executePrepared} from '@cybergarage/orbit'
import type {AgentExecutionOptions, AgentOptions, ManagedToolOptions, PreparedExecutionOptions, RunContext} from '@cybergarage/orbit'
export function executionApi(run: RunContext, managed: ManagedToolOptions, execution: AgentExecutionOptions) {
  const options: AgentOptions = {execution}
  const prepared: PreparedExecutionOptions = {deferPluginStartupFailure: false}
  return {executor: new OperationExecutor(run, managed), executeManagedTool, executePrepared, options, prepared}
}
`,
  )
  runNpm(['run', 'build'], consumer)
  runNpm(['test'], consumer)
  const catalogProbe = path.join(consumer, 'catalog-probe.mjs')
  await writeFile(
    catalogProbe,
    `
import assert from 'node:assert/strict'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {AppleFoundationModelsAgent, getModel, PluginCatalog, PLUGIN_SCHEMA, SqliteProjectStore, OperationExecutor, RunSupervisor, MemoryExecutionJournal} from '@cybergarage/orbit'
assert.ok(getModel('apple') instanceof AppleFoundationModelsAgent)
assert.equal(getModel('apple').getModel(), 'system')
const supervisor = new RunSupervisor()
try {
  const handle = await supervisor.startRun({
    sessionId: 'package', requestId: 'executor', input: {}, configuration: {},
    journal: async () => new MemoryExecutionJournal('package'),
    async execute(run) {
      await run.ready([])
      const executor = new OperationExecutor(run, {policy: {generation: 'package', profile: 'unrestricted', roots: []}})
      const preparation = {binding: {}, effect: 'read', preview: {}, targets: [], revalidate: async () => true, execute: async () => ({content: []})}
      return executor.executePrepared({
        binding: {}, cwd: process.cwd(), effect: 'read', id: 'operation', input: {}, name: 'package', preview: {},
        runId: run.id, sessionId: 'package', targets: [], variant: 'tool-call', version: 1,
      }, preparation)
    },
  })
  assert.equal((await handle.finished).operations[0].status, 'succeeded')
} finally { await supervisor.close() }
assert.equal(PLUGIN_SCHEMA, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json')
assert.deepEqual((await new PluginCatalog([], {dataRoot: path.resolve('plugin-data')}).inspect()).plugins, [])
const store = await SqliteProjectStore.open({file: path.resolve('catalog/projects.sqlite')})
try {
  const id = randomUUID()
  await store.mutate(randomUUID(), {kind: 'create', id, name: 'Package smoke test', directory: null, expectedRevision: 0})
  assert.equal((await store.query({kind: 'project', id})).name, 'Package smoke test')
} finally { await store.close() }
`,
  )
  execFileSync(process.execPath, [catalogProbe], {cwd: consumer, stdio: 'inherit'})
  execFileSync(process.execPath, ['node_modules/@cybergarage/orbit/bin/run.js', '--help'], {
    cwd: consumer,
    stdio: 'inherit',
  })
  if (process.env.ORBIT_RELEASE_DIR) {
    const destination = path.resolve(process.env.ORBIT_RELEASE_DIR)
    await mkdir(destination, {recursive: true})
    await cp(path.join(temporary, packed.filename), path.join(destination, packed.filename))
    console.log(`Verified tarball saved to ${destination}`)
  }

  console.log(`Package verified: ${packed.filename} (${packed.files.length} files)`)
} finally {
  await rm(temporary, {force: true, recursive: true})
}
