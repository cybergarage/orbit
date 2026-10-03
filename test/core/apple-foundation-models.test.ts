// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {spawn} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  AppleFoundationModelsAgent,
  AppleHelperClient,
  ContextOverflowError,
  createProvider,
  getModel,
  getProviderNames,
  Message,
  MessageType,
  ModelAbortError,
} from '../../src/core/index.js'

const user = (content = 'Hello') => new Message(MessageType.User, {content})
const agent = (response?: unknown) =>
  new AppleFoundationModelsAgent('system', createProvider('apple'), {
    transport: {
      async request() {
        return response ?? {text: 'Hello', version: 1}
      },
    },
  })

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }

  throw new Error('Expected rejection')
}

describe('Apple Foundation Models integration', () => {
  describe('model adapter', () => {
    it('registers and exports the optional provider without invoking a helper', () => {
      expect(getProviderNames()).to.include('apple')
      expect(getModel('apple').getModel()).to.equal('system')
      expect(getModel('apple')).to.be.instanceOf(AppleFoundationModelsAgent)
    })

    it('freezes the text conversation and projects normalized output metadata', async () => {
      const messages = [
        new Message(MessageType.Session, {content: 'Be brief'}),
        user('First'),
        new Message(MessageType.Assistant, {content: 'Reply'}),
        user('Second'),
      ]
      const model = agent()
      const prepared = model.prepare(messages, {maxOutputTokens: 42})
      expect(Object.isFrozen(prepared.request)).to.equal(true)
      expect(prepared.request).to.deep.include({maxOutputTokens: 42, operation: 'generate', version: 1})
      messages[3].contents[0] = 'Changed'
      expect((prepared.request.messages as {content: string}[])[3].content).to.equal('Second')
      const result = await prepared.invoke()
      expect(result.content).to.equal('Hello')
      expect(result.parentid).to.equal(messages[3].id)
      expect(result.payload).to.have.nested.property('response.provider', 'apple')
      expect(result.payload).to.have.nested.property('parts.0.type', 'text')
    })

    it('checks actual availability without treating installation as availability', async () => {
      expect(await agent({available: false, reason: 'model_not_ready', version: 1}).probeAvailability()).to.deep.equal({
        available: false,
        reason: 'model_not_ready',
      })
      expect((await failure(agent({version: 1}).probeAvailability())).message).to.include('Invalid Apple availability')
    })

    it('rejects unsupported capabilities before helper dispatch', () => {
      const model = agent()
      expect(() => model.prepare([user()], {tools: [{} as never]})).to.throw('does not support tools')
      expect(() => model.prepare([user()], {responseFormat: 'json'})).to.throw('JSON formatting')
      expect(() => model.prepare([user()], {contextWindow: 4096})).to.throw('cannot be overridden')
      expect(() => model.prepare([new Message(MessageType.Tool)])).to.throw('tool history')
      expect(() =>
        model.prepare([
          new Message(MessageType.Assistant, {payload: {parts: [{data: 'fake', type: 'image'}], response: {}}}),
          user(),
        ]),
      ).to.throw('text only')
      expect(() => model.prepare([user(), new Message(MessageType.Session)])).to.throw('must precede')
      expect(() => model.prepare([user(), user()])).to.throw('alternate')
      expect(() => model.prepare([new Message(MessageType.Assistant), user()])).to.throw('alternate')
      expect(() => model.prepare([user()], {maxOutputTokens: 4097})).to.throw('output cap')
      expect(() => model.prepare([user('x'.repeat(1024 * 1024))])).to.throw('1 MiB')
      expect(() => new AppleFoundationModelsAgent('other', createProvider('apple'))).to.throw('system model')
    })

    it('maps context errors and refuses malformed protocol output', async () => {
      expect(await failure(agent({error: 'context_overflow', version: 1}).invoke([user()]))).to.be.instanceOf(
        ContextOverflowError,
      )
      expect(
        (await failure(agent({error: 'apple_intelligence_not_enabled', version: 1}).invoke([user()]))).message,
      ).to.include('apple_intelligence_not_enabled')
      for (const response of [
        {text: 'Hi', version: 2},
        {text: 9, version: 1},
        {error: {private: 'detail'}, version: 1},
      ]) {
        // eslint-disable-next-line no-await-in-loop
        expect((await failure(agent(response).invoke([user()]))).message).to.include('Invalid Apple')
      }
    })
  })

  describe('Apple helper process boundary', () => {
    let directory: string

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'orbit-apple-test-'))
    })

    afterEach(async () => {
      await rm(directory, {force: true, recursive: true})
    })

    async function client(code: string, timeout = 2000) {
      const script = join(directory, 'helper.cjs')
      await writeFile(script, code)
      const start = (
        _command: string,
        _args: readonly string[],
        options: import('node:child_process').SpawnOptionsWithoutStdio,
      ) => spawn(process.execPath, [script], options)
      return new AppleHelperClient(process.execPath, timeout, start)
    }

    it('sends JSON over stdin without interpreting shell metacharacters', async () => {
      const helper = await client(
        "let s=''; process.stdin.on('data', c => s+=c); process.stdin.on('end', () => {const r=JSON.parse(s);process.stdout.write(JSON.stringify({version:1,text:r.text}))})",
      )
      const text = '$(touch never) `echo nope` ; & |'
      expect(await helper.request({text, version: 1})).to.deep.equal({text, version: 1})
    })

    it('rejects malformed, excessive and unsuccessful output', async () => {
      for (const code of [
        "process.stdout.write('invalid')",
        'process.stdout.write(JSON.stringify({version:2}))',
        "process.stdout.write('x'.repeat(1024*1024+1))",
        'process.exit(3)',
        "process.stderr.write('x'.repeat(17000));setInterval(()=>{},1000)",
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const helper = await client(code)
        // eslint-disable-next-line no-await-in-loop
        expect(await failure(helper.request({version: 1}))).to.be.instanceOf(Error)
      }
    })

    it('reaps timed out and cancelled processes, including SIGTERM refusal', async () => {
      const helper = await client("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)", 300)
      expect((await failure(helper.request({version: 1}))).message).to.include('timed out')
      const controller = new AbortController()
      const pending = (await client('setInterval(()=>{},1000)')).request({version: 1}, controller.signal)
      controller.abort()
      expect(await failure(pending)).to.be.instanceOf(ModelAbortError)
      expect(await failure(helper.request({version: 1}, controller.signal))).to.be.instanceOf(ModelAbortError)
    })

    it('bounds configuration and input and reports missing executables', async () => {
      expect(() => new AppleHelperClient('relative')).to.throw('absolute')
      expect(() => new AppleHelperClient(process.execPath, 0)).to.throw('timeout')
      const helper = new AppleHelperClient(join(directory, 'missing'))
      expect((await failure(helper.request({version: 1}))).message).to.include('Cannot start')
      expect((await failure(helper.request({text: 'x'.repeat(1024 * 1024)}))).message).to.include('input exceeds')
    })
  })
})
