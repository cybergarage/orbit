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
    'dist/core/model-catalog.js',
    'dist/core/model-gateway.js',
    'dist/core/session/model-selection.js',
    'dist/core/session/title.js',
    'dist/core/session/title.d.ts',
    'dist/core/session/repository.d.ts',
    'dist/core/session/information.d.ts',
    'dist/core/projects/service.js',
    'dist/core/projects/service.d.ts',
    'dist/core/maintenance/initialization.js',
    'dist/core/maintenance/initialization.d.ts',
    'dist/apps/cli/initialize.js',
    'docs/initialization.md',
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
  // Local unpublished validation keeps the example on its published base version;
  // the temporary consumer below still installs the exact packed artifact.
  const exampleVersion = packed.version.replace(/-project-memory\.0$/u, '')
  assert.equal(manifest.dependencies['@cybergarage/orbit'], exampleVersion, 'Example must pin the release base version')
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
import {ModelCatalog, ModelGateway, modelSelectionSchema, OperationExecutor, executeManagedTool, executePrepared} from '@cybergarage/orbit'
import type {AgentExecutionOptions, AgentOptions, ManagedToolOptions, PreparedExecutionOptions, RunContext} from '@cybergarage/orbit'
export function executionApi(run: RunContext, managed: ManagedToolOptions, execution: AgentExecutionOptions) {
  const options: AgentOptions = {execution}
  const prepared: PreparedExecutionOptions = {deferPluginStartupFailure: false}
  return {ModelCatalog, ModelGateway, modelSelectionSchema, executor: new OperationExecutor(run, managed), executeManagedTool, executePrepared, options, prepared}
}
`,
  )
  await writeFile(
    path.join(consumer, 'src/rename-api-probe.ts'),
    `// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createSessionInformation, Message, MessageType, ProjectService,
  SessionRepository, SqliteProjectStore,
} from '@cybergarage/orbit'
import type {
  Project, ProjectMutation, SessionInformation, SessionRenameOptions, SessionSummary,
} from '@cybergarage/orbit'

const root = path.resolve('rename-consumer')
await fs.mkdir(root, {recursive: true})
const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
repository.initializeStorage({allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true})
const session = repository.create({cwd: root, model: 'synthetic-model', provider: 'ollama'})
session.appendMessages([new Message(MessageType.User, {content: 'Synthetic conversation preview'})])
const id = session.getId()
const file = session.getFile()!
await session.close()
const transcript = await fs.readFile(file)
const before = (await repository.findById(id))!
const input: SessionRenameOptions = {expectedRevision: 0, operationId: randomUUID(), title: 'Consumer title'}
const renamed: SessionSummary = await repository.rename(id, input)
const title: string | undefined = renamed.title
const revision: number | undefined = renamed.titleRevision
assert.equal(title, 'Consumer title')
assert.equal(revision, 1)
assert.equal(renamed.id, before.id)
assert.equal(renamed.cwd, before.cwd)
assert.equal(renamed.provider, before.provider)
assert.equal(renamed.model, before.model)
assert.deepEqual(await repository.rename(id, input), renamed)
await assert.rejects(repository.rename(id, {...input, title: 'Changed retry'}), /input changed/)
await assert.rejects(repository.rename(id, {...input, operationId: randomUUID()}), /revision changed/)
const reopened = new SessionRepository({rootDir: repository.rootDir})
assert.equal((await reopened.findById(id))?.title, title)
assert.deepEqual(await reopened.rename(id, input), renamed)
const opened = reopened.open(file)
const information: SessionInformation = createSessionInformation(opened)
assert.equal(information.title, title)
assert.equal(information.titleRevision, revision)
await opened.close()
const cleared = await reopened.rename(id, {expectedRevision: 1, operationId: randomUUID(), title: null})
assert.equal(cleared.title, undefined)
assert.equal(cleared.titleRevision, 2)
assert.deepEqual(await fs.readFile(file), transcript)

const store = await SqliteProjectStore.open({file: path.join(root, 'projects.sqlite')})
try {
  const projects = new ProjectService(store, repository, {async closeThread() {}, getThread() {return undefined}}, root)
  const project = await projects.create({directory: root, name: 'Consumer project', operationId: randomUUID()})
  const renameInput = {expectedRevision: project.revision, name: 'Renamed consumer project', operationId: randomUUID()}
  const mutation: ProjectMutation = {id: project.id, kind: 'rename', expectedRevision: renameInput.expectedRevision, name: renameInput.name}
  assert.equal(mutation.kind, 'rename')
  const saved: Project = await projects.rename(project.id, renameInput)
  assert.equal(saved.name, renameInput.name)
  assert.equal(saved.defaultDirectory, project.defaultDirectory)
  assert.equal(saved.revision, project.revision + 1)
  assert.deepEqual(await projects.rename(project.id, renameInput), saved)
  await assert.rejects(projects.rename(project.id, {...renameInput, name: 'Changed retry'}), {code: 'conflict'})
  await assert.rejects(projects.rename(project.id, {...renameInput, operationId: randomUUID()}), {code: 'conflict'})
  assert.equal((await store.query({id: project.id, kind: 'project'}))?.name, saved.name)
} finally {await store.close()}
console.log('Package Rename consumer verified: public declarations, Session title metadata, exact retries and revision conflicts.')
`,
  )
  await writeFile(
    path.join(consumer, 'src/initialization-api-probe.ts'),
    `// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {executeInitialization, planInitialization} from '@cybergarage/orbit'
import type {
  InitializationConsent, InitializationMode, InitializationPlan,
  InitializationProfile, InitializationTarget,
} from '@cybergarage/orbit'

const consent: InitializationConsent = {
  allWritersStopped: true, automaticRestartersDisabled: true,
  confirmation: 'INITIALIZE', exclusiveStorageControl: true,
}
const modes: InitializationMode[] = ['settings', 'data', 'all']
for (const mode of modes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-package-initialization-'))
  try {
    const profile: InitializationProfile = {
      ownedRoots: [root], preservedPaths: [path.join(root, 'workspace')],
      settingsFiles: [path.join(root, 'settings.json')],
      cacheRoots: [path.join(root, 'cache')], scheduledRoots: [path.join(root, 'scheduled')],
      stores: [{sessionRoot: path.join(root, 'sessions'), journalRoot: path.join(root, 'runs'),
        logRoot: path.join(root, 'logs'), projectFile: path.join(root, 'projects.sqlite')}],
    }
    for (const name of ['workspace', 'cache', 'scheduled', 'sessions', 'runs', 'logs']) {
      fs.mkdirSync(path.join(root, name))
      fs.writeFileSync(path.join(root, name, 'fixture.txt'), 'synthetic')
    }
    fs.writeFileSync(profile.settingsFiles[0], '{"apiKey":"SYNTHETIC-PACKAGE-SECRET"}')
    fs.writeFileSync(path.join(root, 'projects.sqlite'), 'synthetic database')
    const plan: InitializationPlan = planInitialization(profile, mode)
    const targets: InitializationTarget[] = plan.targets
    assert.ok(targets.length > 0)
    assert.equal(plan.disposition, 'permanent')
    assert.equal(JSON.stringify(plan).includes('SYNTHETIC-PACKAGE-SECRET'), false)
    // @ts-expect-error Deliberately cross the untyped host boundary to test runtime refusal.
    assert.throws(() => executeInitialization(plan, {...consent, allWritersStopped: false}), /offline/)
    assert.equal(fs.existsSync(profile.settingsFiles[0]), true)
    assert.equal(fs.existsSync(path.join(root, 'sessions', 'fixture.txt')), true)
    const result = executeInitialization(plan, consent)
    assert.deepEqual(result.removed, targets.map((target) => target.path))
    assert.equal(fs.existsSync(profile.settingsFiles[0]), mode === 'data')
    assert.equal(fs.existsSync(path.join(root, 'sessions')), mode === 'settings')
    assert.equal(fs.existsSync(path.join(root, 'runs')), mode === 'settings')
    assert.equal(fs.existsSync(path.join(root, 'logs')), mode === 'settings')
    assert.equal(fs.existsSync(path.join(root, 'projects.sqlite')), mode === 'settings')
    assert.equal(fs.existsSync(path.join(root, 'scheduled')), mode === 'settings')
    assert.equal(fs.existsSync(path.join(root, 'cache')), mode !== 'all')
    assert.equal(fs.readFileSync(path.join(root, 'workspace', 'fixture.txt'), 'utf8'), 'synthetic')
    assert.deepEqual(fs.readdirSync(root).sort(),
      (mode === 'settings' ? ['cache', 'logs', 'projects.sqlite', 'runs', 'scheduled', 'sessions', 'workspace'] :
        mode === 'data' ? ['cache', 'settings.json', 'workspace'] : ['workspace']).sort())
  } finally {fs.rmSync(root, {recursive: true, force: true})}
}
console.log('Package initialization consumer verified: public types, all scopes, consent and retained workspace.')
`,
  )
  runNpm(['run', 'build'], consumer)
  runNpm(['test'], consumer)
  execFileSync(process.execPath, [path.join(consumer, 'dist/rename-api-probe.js')], {cwd: consumer, stdio: 'inherit'})
  execFileSync(process.execPath, [path.join(consumer, 'dist/initialization-api-probe.js')], {
    cwd: consumer,
    stdio: 'inherit',
  })
  const catalogProbe = path.join(consumer, 'catalog-probe.mjs')
  await writeFile(
    catalogProbe,
    `
import assert from 'node:assert/strict'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {ModelCatalog, ModelGateway, modelSelectionSchema, SessionRepository, AppleFoundationModelsAgent, getModel, PluginCatalog, PLUGIN_SCHEMA, SqliteProjectStore, OperationExecutor, RunSupervisor, MemoryExecutionJournal} from '@cybergarage/orbit'
const selection = modelSelectionSchema.parse({provider: 'openai', model: 'gpt-4o'})
const modelSettings = {providers: {openai: {apiKey: 'fake-package-key'}, anthropic: {apiKeyEnv: 'ORBIT_PACKAGE_ABSENT_KEY'}}}
const modelCatalog = new ModelCatalog({
  fetcher: async () => {throw new Error('Synthetic local service offline')},
  listRemote: async () => [{id: 'gpt-4o'}, {id: 'whisper-1'}],
})
const choices = await modelCatalog.list(modelSettings)
assert.deepEqual(choices.providers.find(provider => provider.provider === 'openai').models.map(model => model.model), ['gpt-4o'])
await modelCatalog.requireSelection(modelSettings, selection)
const gateway = new ModelGateway(modelSettings, selection, {openai: {chat: {completions: {create: async request => ({model: request.model})}}}})
assert.deepEqual(await gateway.request('openai-chat', {messages: [], model: selection.model}, new AbortController().signal), {model: selection.model})
await assert.rejects(gateway.request('chat', {}, new AbortController().signal), /admitted provider/)
const modelRepository = new SessionRepository({rootDir: path.resolve('model-sessions')})
modelRepository.initializeStorage({allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true})
const modelSession = modelRepository.create({cwd: process.cwd(), provider: 'ollama', model: 'original'})
const modelSessionId = modelSession.getId()
modelSession.selectModel(selection)
await modelSession.close()
assert.equal((await new SessionRepository({rootDir: modelRepository.rootDir}).findById(modelSessionId)).provider, 'openai')
assert.equal((await modelRepository.findById(modelSessionId)).model, 'gpt-4o')
console.log('Package model consumer verified: catalog, gateway, declarations and persisted selection; no inference.')
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
  const initializeHelp = execFileSync(
    process.execPath,
    ['node_modules/@cybergarage/orbit/bin/run.js', 'initialize', '--help'],
    {
      cwd: consumer,
      encoding: 'utf8',
    },
  )
  assert.match(initializeHelp, /--dry-run/u)
  assert.match(initializeHelp, /--settings-file/u)
  assert.match(initializeHelp, /--confirm-initialize/u)
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
