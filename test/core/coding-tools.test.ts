// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

import type {ModelToolCall} from '../../src/core/models/index.js'
import type {ToolDefinition, ToolExecutionContext, ToolResult} from '../../src/core/tools/index.js'

import {
  createBashTool,
  createBuiltinTools,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createListTool,
  createReadTool,
  createWriteTool,
  textToolResult,
  ToolProfile,
  ToolRegistry,
  toolResultText,
  ToolRuntime,
  zodToolInput,
} from '../../src/core/tools/index.js'

describe('coding tools', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-coding-tools-'))
  })

  it('creates the complete coding profile in stable order', () => {
    expect(createBuiltinTools({profile: ToolProfile.Coding}).map((tool) => tool.spec.name)).to.deep.equal([
      'bash',
      'edit',
      'glob',
      'grep',
      'list',
      'read',
      'write',
    ])
  })

  it('supports explicit profile additions and exclusions', () => {
    expect(
      createBuiltinTools({exclude: ['bash', 'write'], include: ['read'], profile: ToolProfile.Coding}).map(
        (tool) => tool.spec.name,
      ),
    ).to.deep.equal(['edit', 'glob', 'grep', 'list', 'read'])
    expect(
      createBuiltinTools({include: ['read'], profile: ToolProfile.None}).map((tool) => tool.spec.name),
    ).to.deep.equal(['read'])
  })

  it('reads selected lines from UTF-8 files and rejects directories', async () => {
    await fs.writeFile(path.join(root, 'sample.txt'), 'one\ntwo\nthree\n')
    const result = await invoke(createReadTool(), {limit: 2, offset: 2, path: 'sample.txt'}, root)

    expect(toolResultText(result)).to.equal('two\nthree')
    expect(result.details).to.include({endLine: 3, startLine: 2})
    await expectToolError(invoke(createReadTool(), {path: '.'}, root), 'Use list instead')
  })

  it('lists directory entries deterministically and hides dotfiles by default', async () => {
    await fs.writeFile(path.join(root, 'b.txt'), '')
    await fs.writeFile(path.join(root, 'a.txt'), '')
    await fs.writeFile(path.join(root, '.hidden'), '')
    await fs.mkdir(path.join(root, 'folder'))

    expect(toolResultText(await invoke(createListTool(), {}, root))).to.equal(
      ['file\ta.txt', 'file\tb.txt', 'directory\tfolder'].join('\n'),
    )
    expect(toolResultText(await invoke(createListTool(), {includeHidden: true}, root))).to.contain('.hidden')
  })

  it('finds glob paths while honoring root gitignore rules', async () => {
    await fs.mkdir(path.join(root, 'src'))
    await fs.mkdir(path.join(root, 'ignored'))
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored/\n')
    await fs.writeFile(path.join(root, 'src', 'b.ts'), '')
    await fs.writeFile(path.join(root, 'src', 'a.ts'), '')
    await fs.writeFile(path.join(root, 'ignored', 'secret.ts'), '')

    expect(toolResultText(await invoke(createGlobTool(), {pattern: '**/*.ts'}, root))).to.equal('src/a.ts\nsrc/b.ts')
  })

  it('searches text with regular expressions, literals, and glob filters', async () => {
    await fs.mkdir(path.join(root, 'src'))
    await fs.writeFile(path.join(root, 'src', 'first.ts'), 'Orbit tool\nother\nORBIT runtime\n')
    await fs.writeFile(path.join(root, 'src', 'second.js'), 'Orbit ignored by glob\n')

    const regex = await invoke(
      createGrepTool(),
      {glob: '**/*.ts', ignoreCase: true, path: 'src', pattern: '^orbit'},
      root,
    )
    expect(toolResultText(regex)).to.equal(['src/first.ts:1:1:Orbit tool', 'src/first.ts:3:1:ORBIT runtime'].join('\n'))
    const literal = await invoke(createGrepTool(), {literal: true, path: 'src/first.ts', pattern: 'tool'}, root)
    expect(toolResultText(literal)).to.equal('src/first.ts:1:7:Orbit tool')
  })

  it('edits unique text and requires replaceAll for repeated text', async () => {
    const file = path.join(root, 'sample.txt')
    await fs.writeFile(file, 'old\nold\n')

    await expectToolError(
      invoke(createEditTool(), {newText: 'new', oldText: 'old', path: 'sample.txt'}, root),
      'occurs 2 times',
    )
    const result = await invoke(
      createEditTool(),
      {newText: 'new', oldText: 'old', path: 'sample.txt', replaceAll: true},
      root,
    )
    expect(toolResultText(result)).to.equal('Updated sample.txt')
    expect(await fs.readFile(file, 'utf8')).to.equal('new\nnew\n')
  })

  it('creates parent directories and completely overwrites files', async () => {
    const tool = createWriteTool()
    expect(toolResultText(await invoke(tool, {content: 'first', path: 'nested/file.txt'}, root))).to.equal(
      'Created nested/file.txt',
    )
    expect(toolResultText(await invoke(tool, {content: 'second', path: 'nested/file.txt'}, root))).to.equal(
      'Overwrote nested/file.txt',
    )
    expect(await fs.readFile(path.join(root, 'nested', 'file.txt'), 'utf8')).to.equal('second')
  })

  it('accepts absolute paths for full-access file operations', async () => {
    const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-coding-tools-outside-')), 'file.txt')
    await invoke(createWriteTool(), {content: 'outside', path: outside}, root)
    expect(await fs.readFile(outside, 'utf8')).to.equal('outside')
  })

  it('executes Bash commands and reports non-zero exits as completed results', async () => {
    if (process.platform === 'win32' && process.env.ORBIT_BASH_PATH === undefined) return
    const success = await invoke(createBashTool(), {command: "printf 'hello'"}, root)
    expect(toolResultText(success)).to.equal('hello')
    expect(success.details).to.include({exitCode: 0, timedOut: false})

    const failure = await invoke(createBashTool(), {command: 'exit 7'}, root)
    expect(failure.isError).to.not.equal(true)
    expect(failure.details).to.include({exitCode: 7})
  })

  describe('ToolRegistry and ToolRuntime', () => {
    it('rejects duplicate names with source details', () => {
      const registry = new ToolRegistry()
      registry.register(createReadTool())
      expect(() => registry.register(createReadTool())).to.throw('Duplicate tool name: read')
    })

    it('exposes only model specifications', () => {
      const registry = new ToolRegistry()
      registry.register(createReadTool())
      expect(registry.snapshot().specs()).to.deep.equal([
        {
          description: 'Read a UTF-8 text file. Use offset and limit for large files.',
          inputSchema: createReadTool().input.jsonSchema,
          name: 'read',
        },
      ])
    })

    it('runs parallel calls together and treats serial calls as barriers', async () => {
      const events: string[] = []
      const registry = new ToolRegistry()
      registry.register(createTestTool('first', 'parallel', events, 10))
      registry.register(createTestTool('second', 'parallel', events, 5))
      registry.register(createTestTool('write', 'serial', events, 0))
      registry.register(createTestTool('after', 'parallel', events, 0))
      const calls: ModelToolCall[] = ['first', 'second', 'write', 'after'].map((name) => ({id: name, input: {}, name}))

      const runtime = new ToolRuntime(registry.snapshot())
      const results = await runtime.executeAll(calls, (call) => createContext('.', call.id))

      expect(results.map((result) => result.toolCall.name)).to.deep.equal(['first', 'second', 'write', 'after'])
      expect(events.indexOf('write:start')).to.be.greaterThan(events.indexOf('first:end'))
      expect(events.indexOf('write:start')).to.be.greaterThan(events.indexOf('second:end'))
      expect(events.indexOf('after:start')).to.be.greaterThan(events.indexOf('write:end'))
    })

    it('returns unknown and validation failures as normalized errors', async () => {
      const registry = new ToolRegistry()
      registry.register(createTestTool('known', 'parallel', [], 0))
      const runtime = new ToolRuntime(registry.snapshot())
      const calls: ModelToolCall[] = [
        {id: 'missing', input: {}, name: 'missing'},
        {id: 'invalid', input: {value: 'bad'}, name: 'known'},
      ]
      const results = await runtime.executeAll(calls, (call) => createContext('.', call.id))

      expect(results.every((result) => result.result.isError === true)).to.equal(true)
      expect(toolResultText(results[0].result)).to.equal('Unknown tool: missing')
    })
  })
})

async function invoke(definition: ToolDefinition, input: unknown, cwd: string): Promise<ToolResult> {
  return definition.execute(definition.input.parse(input), createContext(cwd, definition.spec.name))
}

function createContext(cwd: string, callId: string): ToolExecutionContext {
  return {
    callId,
    cwd,
    emitUpdate() {},
    signal: new AbortController().signal,
  }
}

function createTestTool(
  name: string,
  scheduling: 'parallel' | 'serial',
  events: string[],
  delay: number,
): ToolDefinition<{value?: number}> {
  const input = zodToolInput(z.object({value: z.number().optional()}))
  return {
    async execute() {
      events.push(`${name}:start`)
      await new Promise((resolve) => {
        setTimeout(resolve, delay)
      })
      events.push(`${name}:end`)
      return textToolResult(name)
    },
    input,
    scheduling,
    source: {id: 'test', kind: 'custom'},
    spec: {description: name, inputSchema: input.jsonSchema, name},
  }
}

async function expectToolError(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise
    expect.fail('Expected tool execution to fail.')
  } catch (error) {
    expect(error).to.be.instanceOf(Error)
    expect((error as Error).message).to.contain(expected)
  }
}
