// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-template-curly-in-string */
import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  Agent,
  MemorySessionLogStore,
  Message,
  MessageType,
  PLUGIN_MCP_SCHEMA,
  PLUGIN_SCHEMA,
  PluginCatalog,
} from '../../src/core/index.js'
import {createMcpToolManager} from '../../src/core/mcp.js'
import {expandPluginValue} from '../../src/core/plugins/catalog.js'
import {parseSkillSource, SKILL_PORTABLE_PROJECTION_REVISION} from '../../src/core/skills/parser.js'
import {parseSkillEntry} from '../../src/core/skills/record.js'

const json = async (file: string, value: unknown) => fs.writeFile(file, JSON.stringify(value))
async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch {
    return
  }

  throw new Error('Expected rejection')
}

describe('portable local plugins', () => {
  let root: string
  let pkg: string
  let data: string
  let catalog: PluginCatalog

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-plugin-')))
    pkg = path.join(root, 'package')
    data = path.join(root, 'data')
    await fs.mkdir(pkg)
    await json(path.join(pkg, 'plugin.json'), {$schema: PLUGIN_SCHEMA, name: 'test.plugin'})
    catalog = new PluginCatalog([{directory: pkg, id: 'test'}], {dataRoot: data})
  })

  afterEach(async () => fs.rm(root, {force: true, recursive: true}))
  async function mcp(servers: unknown) {
    await json(path.join(pkg, 'mcp.json'), {$schema: PLUGIN_MCP_SCHEMA, mcpServers: servers})
  }

  async function skill(
    source = '---\nname: example\ndescription: Example\nmetadata:\n  author: Orbit\nallowed-tools: read\n---\n',
  ) {
    await fs.mkdir(path.join(pkg, 'skills', 'example'), {recursive: true})
    await fs.writeFile(path.join(pkg, 'skills', 'example', 'SKILL.md'), source)
  }

  it('exports a side-effect-free catalog and isolates manifest exceptions', async () => {
    await json(path.join(pkg, 'plugin.json'), {$schema: PLUGIN_SCHEMA, extensions: 3, future: 42, name: 'test.plugin'})
    const inspection = await catalog.inspect()
    expect(inspection.plugins).length(1)
    expect(inspection.diagnostics.map((d) => d.code)).deep.equal(['ignored-manifest-field', 'ignored-extensions'])
    await rejection(fs.stat(data))
    await json(path.join(pkg, 'plugin.json'), {$schema: PLUGIN_SCHEMA, author: {unknown: 'x'}, name: 'test.plugin'})
    expect((await catalog.inspect()).plugins).length(0)
  })

  it('rejects invalid identities and data roots without touching package code', async () => {
    expect(() => new PluginCatalog([{directory: pkg, id: '../x'}], {dataRoot: data})).throws()
    expect(
      () =>
        new PluginCatalog(
          [
            {directory: pkg, id: 'x'},
            {directory: pkg, id: 'x'},
          ],
          {dataRoot: data},
        ),
    ).throws()
    const bad = new PluginCatalog([{directory: pkg, id: 'test'}], {dataRoot: path.join(pkg, 'data')})
    expect((await bad.inspect()).plugins).length(0)
  })

  it('isolates invalid server entries, unsupported transports and MCP document errors', async () => {
    await skill()
    await mcp({
      bad: {command: 'node', extra: 1, type: 'stdio'},
      good: {command: 'node', type: 'stdio'},
      remote: {type: 'streamable-http', url: 'https://example.invalid/mcp'},
      reserved: {command: 'node', env: {PLUGIN_ROOT: 'bad'}, type: 'stdio'},
    })
    const inspection = await catalog.inspect()
    expect(Object.keys(inspection.servers)).deep.equal(['plugin:test:good'])
    expect(inspection.diagnostics.map((d) => d.code)).deep.equal([
      'invalid-server',
      'unsupported-transport',
      'invalid-server',
    ])
    await json(path.join(pkg, 'mcp.json'), {$schema: 'unknown', mcpServers: {}})
    const isolated = await catalog.inspect()
    expect(isolated.skillRoots).length(1)
    expect(isolated.diagnostics[0].scope).equal('mcp')
  })

  it('does one-pass expansion, preserves literals and binds the plugin working directory', async () => {
    expect(expandPluginValue('${PLUGIN_ROOT}/${PLUGIN_DATA}/${HOME}', '${PLUGIN_DATA}', '/data')).equal(
      '${PLUGIN_DATA}//data/${HOME}',
    )
    await mcp({
      one: {args: ['${PLUGIN_ROOT}/app.js', '${OTHER}'], command: 'node', env: {DIR: '${PLUGIN_DATA}'}, type: 'stdio'},
    })
    const server = (await catalog.inspect()).servers['plugin:test:one']
    expect(server.args).deep.equal([path.join(pkg, 'app.js'), '${OTHER}'])
    expect(server.plugin?.cwd).equal(pkg)
    expect(server.env).deep.equal({
      DIR: path.join(data, 'test'),
      PLUGIN_DATA: path.join(data, 'test'),
      PLUGIN_ROOT: pkg,
    })
  })

  it('retains instance data across relocation while invalidating loaded bindings', async () => {
    await mcp({one: {command: 'node', type: 'stdio'}})
    const loaded = await catalog.load()
    await fs.mkdir(path.join(data, 'test'), {recursive: true})
    await fs.writeFile(path.join(data, 'test', 'retained'), 'state')
    await json(path.join(pkg, 'plugin.json'), {$schema: PLUGIN_SCHEMA, name: 'test.plugin', version: '2'})
    await rejection(loaded.validate())
    const moved = path.join(root, 'moved')
    await fs.rename(pkg, moved)
    const updated = new PluginCatalog([{directory: moved, id: 'test'}], {dataRoot: data})
    expect((await updated.inspect()).plugins[0].data).equal(path.join(data, 'test'))
    expect(await fs.readFile(path.join(data, 'test', 'retained'), 'utf8')).equal('state')
  })

  it('loads portable Skill metadata, minimal bodies and rejects snapshot tampering', async () => {
    await skill()
    const loaded = await catalog.load()
    const listing = await loaded.skillCatalog.list()
    expect(listing.candidates).length(1)
    const [snapshot] = await loaded.skillCatalog.resolve(listing.candidates)
    expect(snapshot.projectionRevision).equal(SKILL_PORTABLE_PROJECTION_REVISION)
    expect(snapshot.metadata).deep.equal({author: 'Orbit'})
    expect(snapshot.body).equal('')
    const entry = {
      id: 'entry',
      sessionId: 'session',
      skills: [snapshot],
      timestamp: 'now',
      turnId: 'turn',
      type: 'skill_context',
      version: 1,
    }
    expect(parseSkillEntry(entry).skills[0].allowedTools).equal('read')
    snapshot.metadata!.author = 'tampered'
    expect(() => parseSkillEntry(entry)).throws('derivation')
    expect(() => parseSkillSource('---\nname: a\ndescription: A\nmetadata:\n  x: 1\n---\n')).throws()
  })

  it('denies escaping resources and permits internal aliases with stale-path detection', async function () {
    if (process.platform === 'win32') this.skip()
    await skill('---\nname: example\ndescription: Example\n---\nInstructions')
    await fs.rename(path.join(pkg, 'skills', 'example'), path.join(pkg, 'content'))
    await fs.symlink('../content', path.join(pkg, 'skills', 'example'))
    const loaded = await catalog.load()
    const listing = await loaded.skillCatalog.list()
    expect(listing.candidates).length(1)
    expect((await loaded.skillCatalog.resolve(listing.candidates))[0].plugin?.resolvedDirectory).equal(
      path.join(pkg, 'content'),
    )
    expect(await catalog.readResource('test', 'content/SKILL.md')).contains('Instructions')
    await fs.writeFile(path.join(root, 'outside'), 'secret')
    await fs.symlink(path.join(root, 'outside'), path.join(pkg, 'escape'))
    await rejection(catalog.readResource('test', 'escape'))
    await rejection(catalog.readResource('test', '../outside'))
    await fs.unlink(path.join(pkg, 'skills', 'example'))
    await fs.mkdir(path.join(pkg, 'skills', 'example'))
    await rejection(loaded.skillCatalog.resolve(listing.candidates))
  })

  it('does not recursively discover Skills and reports invalid siblings', async () => {
    await skill()
    await fs.mkdir(path.join(pkg, 'skills', 'parent', 'deep'), {recursive: true})
    await fs.writeFile(
      path.join(pkg, 'skills', 'parent', 'deep', 'SKILL.md'),
      '---\nname: deep\ndescription: Deep\n---\nbody',
    )
    const list = await (await catalog.load()).skillCatalog.list()
    expect(list.candidates.map((c) => c.name)).deep.equal(['example'])
  })

  it('loads healthy siblings after an unknown startup but prevents model execution', async () => {
    await mcp({bad: {command: 'node', type: 'stdio'}, good: {command: 'node', type: 'stdio'}})
    const plugins = await catalog.load()
    const connected: string[] = []
    let closed = 0
    let models = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createMcpToolManager: (settings, options) =>
          createMcpToolManager(settings.mcp, {
            ...options,
            clientFactory: (name) => ({
              async callTool() {
                return {}
              },
              async close() {
                closed++
              },
              async connect() {
                connected.push(name)
                if (name.endsWith(':bad')) throw new Error('secret-environment-value')
              },
              async listTools() {
                return {tools: []}
              },
            }),
            transportFactory: () => ({}) as never,
          }),
        createModel: () => ({
          getModel: () => 'test',
          getName: () => 'test',
          getProvider: () => 'ollama',
          async invoke() {
            models++
            return new Message(MessageType.Assistant, {content: 'done'})
          },
        }),
      },
      execution: {policy: {generation: 'test', profile: 'unrestricted', roots: [root]}},
      logStore: new MemorySessionLogStore(),
      plugins,
    })
    try {
      const result = await (await agent.startRun([new Message(MessageType.User, {content: 'test'})])).finished
      expect(connected).deep.equal(['plugin:test:bad', 'plugin:test:good'])
      expect(models).equal(0)
      expect(closed).equal(2)
      expect(result.operations.some((o) => o.status === 'unknown')).equal(true)
      await agent.supervisor.reconcileRun(result.runId, {
        confirmedStopped: true,
        operations: result.operations.map((o) => ({id: o.id, status: 'failed'})),
      })
    } finally {
      await agent.close()
    }
  })

  for (const mode of ['cancel', 'budget', 'journal'] as const) {
    it(`stops plugin discovery on ${mode} instead of treating it as an isolated server failure`, async () => {
      await mcp({first: {command: 'node', type: 'stdio'}, second: {command: 'node', type: 'stdio'}})
      const plugins = await catalog.load()
      const connected: string[] = []
      let models = 0
      const agent = new Agent({
        cwd: root,
        deps: {
          createMcpToolManager(settings, options) {
            const {run} = (options!.execution!)
            if (mode === 'journal') {
              const append = run.journal.append.bind(run.journal)
              run.journal.append = async (...args) => {
                if (args[1] === 'operation-result') throw new Error('Simulated journal failure')
                return append(...args)
              }
            }

            return createMcpToolManager(settings.mcp, {
              ...options,
              clientFactory: (name) => ({
                async callTool() {
                  return {}
                },
                async close() {},
                async connect() {
                  connected.push(name)
                  if (mode === 'cancel') run.requestStop('user')
                  if (mode === 'budget') run.consume('toolRequests', run.limits.toolRequests + 1)
                },
                async listTools() {
                  return {tools: []}
                },
              }),
              transportFactory: () => ({}) as never,
            })
          },
          createModel: () => ({
            getModel: () => 'test',
            getName: () => 'test',
            getProvider: () => 'ollama',
            async invoke() {
              models++
              return new Message(MessageType.Assistant, {content: 'unexpected'})
            },
          }),
        },
        execution: {policy: {generation: 'test', profile: 'unrestricted', roots: [root]}},
        logStore: new MemorySessionLogStore(),
        plugins,
      })
      try {
        const result = await (await agent.startRun([new Message(MessageType.User, {content: 'test'})])).finished
        expect(connected).deep.equal(['plugin:test:first'])
        expect(models).equal(0)
        expect(result.outcome).not.equal('completed')
        const reconciled = agent.supervisor.reconcileRun(result.runId, {
          confirmedStopped: true,
          operations: result.operations.map((o) => ({id: o.id, status: 'failed'})),
        })
        await (mode === 'journal' ? rejection(reconciled) : reconciled);
      } finally {
        await agent.close()
      }
    })
  }

  it('keeps native collisions explicit and does not turn allowed-tools into approval', async () => {
    await mcp({server: {command: 'node', type: 'stdio'}})
    const plugins = await catalog.load()
    expect(
      () => new Agent({cwd: root, plugins, settings: {mcp: {servers: {'plugin:test:server': {command: 'native'}}}}}),
    ).throws('identity conflict')
    let connections = 0
    let models = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createMcpToolManager: (settings, options) =>
          createMcpToolManager(settings.mcp, {
            ...options,
            clientFactory: () => ({
              async callTool() {
                return {}
              },
              async close() {},
              async connect() {
                connections++
              },
              async listTools() {
                return {tools: []}
              },
            }),
            transportFactory: () => ({}) as never,
          }),
        createModel: () => ({
          getModel: () => 'test',
          getName: () => 'test',
          getProvider: () => 'ollama',
          async invoke() {
            models++
            return new Message(MessageType.Assistant, {content: 'done'})
          },
        }),
      },
      execution: {policy: {decide: () => 'deny', generation: 'deny', profile: 'workspace-confirm', roots: [root]}},
      logStore: new MemorySessionLogStore(),
      plugins,
    })
    try {
      const result = await (await agent.startRun([new Message(MessageType.User, {content: 'test'})])).finished
      expect(connections).equal(0)
      expect(models).equal(1)
      expect(result.operations[0].status).equal('denied')
    } finally {
      await agent.close()
    }
  })

  it('rejects oversized files and wrong component kinds without losing the other component', async () => {
    await skill()
    await fs.mkdir(path.join(pkg, 'mcp.json'))
    expect((await catalog.inspect()).skillRoots).length(1)
    expect((await catalog.inspect()).diagnostics[0].scope).equal('mcp')
    await fs.writeFile(path.join(pkg, 'plugin.json'), ' '.repeat(1_048_577))
    const oversized = await catalog.inspect()
    expect(oversized.plugins).length(0)
    expect(oversized.complete).equal(false)
    expect(oversized.diagnostics[0].code).equal('plugin-byte-limit')
  })

  it('validates remote headers and never connects an unsupported transport', async () => {
    await mcp({
      plain: {type: 'sse', url: 'http://example.invalid'},
      remote: {headers: {X: 'one', x: 'two'}, type: 'streamable-http', url: 'https://example.invalid'},
    })
    const inspection = await catalog.inspect()
    expect(Object.keys(inspection.servers)).length(0)
    expect(inspection.diagnostics.map((d) => d.code)).deep.equal(['invalid-server', 'invalid-server'])
  })

  it('starts a real stdio server in the package and preserves data and original tool names', async () => {
    await fs.writeFile(
      path.join(pkg, 'server.cjs'),
      `const fs=require('node:fs'); fs.writeFileSync(process.env.PLUGIN_DATA+'/pid',String(process.pid)); require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;const result=r.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:r.method==='tools/list'?{tools:[{name:'echo',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:JSON.stringify({cwd:process.cwd(),root:process.env.PLUGIN_ROOT,data:process.env.PLUGIN_DATA,name:r.params.name})}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n')});`,
    )
    await mcp({
      failed: {args: ['-e', 'process.exit(1)'], command: 'node', type: 'stdio'},
      remote: {type: 'streamable-http', url: 'https://example.invalid/mcp'},
      server: {args: ['${PLUGIN_ROOT}/server.cjs'], command: 'node', type: 'stdio'},
    })
    const plugins = await catalog.load()
    const manager = createMcpToolManager({servers: plugins.inspection.servers}, {cwd: root})
    try {
      const tools = await manager.getTools()
      expect(tools).length(1)
      expect(tools[0].name).length(63)
      const result = (await tools[0].invoke({} as never)) as {content: Array<{text: string}>}
      expect(JSON.parse(result.content[0].text)).deep.equal({
        cwd: pkg,
        data: path.join(data, 'test'),
        name: 'echo',
        root: pkg,
      })
    } finally {
      await manager.close()
    }

    const pid = Number(await fs.readFile(path.join(data, 'test', 'pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).throws()
  })
})
