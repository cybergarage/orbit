// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Node 20.19 provides fetch; this isolated local HTTP fixture requires no network service.
/* eslint-disable n/no-unsupported-features/node-builtins */
import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {RunSnapshot} from '../../../src/core/index.js'

import {startGuiServer} from '../../../src/apps/gui/server.js'
import {
  Agent,
  MemorySessionLogStore,
  Message,
  MessageType,
  OrbitApplicationService,
  ToolProfile,
} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

async function poll(read: () => Promise<RunSnapshot>, ready: (snapshot: RunSnapshot) => boolean): Promise<RunSnapshot> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    // Poll the authoritative snapshot while the simulated application progresses.
    // eslint-disable-next-line no-await-in-loop
    const snapshot = await read()
    if (ready(snapshot)) return snapshot
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })
  }

  throw new Error('Run snapshot did not reach the expected state')
}

for (const formatVersion of [2, 3] as const)
  for (const ending of formatVersion === 3 ? ['approve', 'cancel'] : ['approve'])
    describe('GUI managed execution API v' + formatVersion + ' ' + ending, () => {
      it('deduplicates lost replies and authenticates one-time decisions across two clients', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-gui-execution-'))
        let modelCalls = 0
        let agents = 0
        const service = new OrbitApplicationService({
          contexts: [],
          createAgent(options) {
            agents++
            return new Agent({
              ...options,
              deps: {
                createModel: () => ({
                  getModel: () => 'test-model',
                  getName: () => 'model',
                  getProvider: () => 'ollama',
                  async invoke() {
                    modelCalls++
                    return modelCalls === 1
                      ? new Message(MessageType.Assistant, {
                          payload: {
                            toolCalls: [
                              {id: 'call', input: {content: 'approved once', path: 'answer.txt'}, name: 'write'},
                            ],
                          },
                        })
                      : new Message(MessageType.Assistant, {content: 'done'})
                  },
                  prepare(messages, options) {
                    return {invoke: () => this.invoke(messages, options), request: {}}
                  },
                }),
              },
              execution: {onApproval() {}, responderScope: 'local-gui'},
              toolProfile: ToolProfile.Coding,
            })
          },
          cwd: root,
          logStore: new MemorySessionLogStore(),
          model: 'test-model',
          provider: 'ollama',
          repository: new SessionRepository({rootDir: path.join(root, 'sessions')}),
          settings: formatVersion === 3 ? {interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1}} : {},
          settingsSources: [],
        })
        service.updatePreferences({diagnosticCapture: 'off'})
        const snapshots: RunSnapshot[] = []
        const unsubscribe = service.subscribeRunSnapshots((snapshot) => snapshots.push(snapshot))
        const server = await startGuiServer({service, token: 'fake-test-capability'})
        const base = `http://${server.host}:${server.port}`
        const headers = {'Content-Type': 'application/json', 'X-Orbit-Token': server.token}
        const post = (url: string, body: unknown, suppliedHeaders = headers) =>
          fetch(base + url, {body: JSON.stringify(body), headers: suppliedHeaders, method: 'POST'})
        try {
          const thread = (await (await post('/api/threads', {})).json()) as {id: string}
          const uri = `/api/threads/${thread.id}/messages`
          const first = await post(uri, {content: 'edit', requestId: 'retry-key'})
          expect(first.status).equal(202)
          const admitted = (await first.json()) as {kind: string; runId: string}
          expect(admitted.kind).equal('run')
          const query = async () =>
            (await (await fetch(`${base}/api/runs/${admitted.runId}`, {headers})).json()) as RunSnapshot
          const waiting = await poll(query, (snapshot) => snapshot.approvals.length === 1)
          const approval = waiting.approvals[0]
          const second = await post(uri, {content: 'edit', requestId: 'retry-key'})
          expect(await second.json()).deep.equal({...admitted, threadId: thread.id})
          expect((await post(uri, {content: 'different', requestId: 'retry-key'})).status).equal(409)
          expect(agents).equal(1)
          expect(modelCalls).equal(1)
          if (ending === 'cancel') {
            expect((await post(`/api/runs/${admitted.runId}/cancel`, {})).status).equal(202)
            const cancelled = await poll(query, (s) => Boolean(s.result))
            expect(cancelled.result?.outcome).equal('cancelled')
            expect(cancelled.result?.quiescence).equal(true)
            const next = await post(uri, {content: 'continue without the old operation', requestId: 'continue'})
            expect(next.status).equal(202)
            const continuation = (await next.json()) as {runId: string}
            const completed = await poll(
              async () =>
                (await (await fetch(`${base}/api/runs/${continuation.runId}`, {headers})).json()) as RunSnapshot,
              (s) => Boolean(s.result),
            )
            expect(completed.result?.outcome).equal('completed')
            expect(modelCalls).equal(2)
            const replay = await post(uri, {content: 'continue without the old operation', requestId: 'continue'})
            expect(((await replay.json()) as {runId: string}).runId).equal(continuation.runId)
            expect(modelCalls).equal(2)
            expect(await fs.stat(path.join(root, 'answer.txt')).catch(() => null)).equal(null)
            expect((await query()).result?.outcome).equal('cancelled')
            return
          }

          const reply = {approve: true, digest: approval.digest, requestId: approval.id}
          const replies = `/api/runs/${admitted.runId}/approvals`
          expect((await post(replies, reply, {'Content-Type': 'application/json'} as typeof headers)).status).equal(403)
          expect((await post(replies, {...reply, digest: '0'.repeat(64)})).status).equal(409)
          const [clientA, clientB] = await Promise.all([post(replies, reply), post(replies, reply)])
          expect(clientA.status).equal(200)
          expect(clientB.status).equal(200)
          expect((await post(replies, {...reply, approve: false})).status).equal(409)
          const terminal = await poll(query, (snapshot) => Boolean(snapshot.result))
          expect(terminal.sequence).greaterThan(waiting.sequence)
          expect(terminal.result?.outcome).equal('completed')
          expect(terminal.result?.recording.status).equal('acknowledged')
          expect(await fs.readFile(path.join(root, 'answer.txt'), 'utf8')).equal('approved once')
          expect(snapshots.some((snapshot) => snapshot.approvals.length > 0)).equal(true)
          expect(snapshots.at(-1)?.result?.outcome).equal('completed')
          expect(
            snapshots.every((snapshot, index) => index === 0 || snapshot.sequence > snapshots[index - 1].sequence),
          ).equal(true)
          expect(modelCalls).equal(2)
          const repeated = await post(uri, {content: 'edit', requestId: 'retry-key'})
          expect(((await repeated.json()) as {runId: string}).runId).equal(admitted.runId)
          expect(modelCalls).equal(2)
          const stopped = await post(`/api/runs/${admitted.runId}/cancel`, {})
          expect(((await stopped.json()) as {status: string}).status).equal('already-terminal')
        } finally {
          unsubscribe()
          await server.close()
          await service.close()
          await fs.rm(root, {force: true, recursive: true})
        }
      })
    })
