// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import {inspectExecutionJournal} from '../../../src/core/execution/recovery.js'
import {Agent, compileProcessorGraph, inspectGraphRun, MemorySessionLogStore, State} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

const child=promisify(execFile)
describe('Graph process interruption',()=>{
  for(const checkpoint of ['run-admitted','graph-bound','run-ready','graph-node-started','graph-node-completed','graph-transition','run-terminal']) it(`observes without redispatch after death at ${checkpoint}`,async()=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'orbit-graph-exit-')))
    let agent:Agent | undefined
    try {
      await child(process.execPath,['test/core/execution/fixtures/graph-interruption.mjs'],{env:{...process.env,ORBIT_GRAPH_CHECKPOINT:checkpoint,ORBIT_GRAPH_ROOT:root},timeout:15_000}).then(()=>{throw new Error('Missing checkpoint exit')},error=>{expect(error.code,error.stderr).eq(73);expect(error.killed).not.eq(true)})
      const repository=new SessionRepository({journalRoot:path.join(root,'journal'),rootDir:path.join(root,'sessions')});const session=repository.open((await repository.findById('interrupted'))!.file)
      const graph=await compileProcessorGraph({edges:[{from:'first',id:'finish',to:'done'}],entry:'first',id:'interruption',nodes:[{adapter:'copy',id:'first'}],terminals:[{id:'done',outcome:'completed'}]},[{id:'copy',inputSchema:{},invoke(){throw new Error('Must not redispatch')},kind:'transform',outputSchema:{},version:'1'}])
      agent=new Agent({cwd:root,deps:{createModel:()=>({getModel:()=> 'fixture',getName:()=> 'fixture',getProvider:()=> 'ollama',async invoke(){throw new Error('Unexpected model')}})},logStore:new MemorySessionLogStore(),state:new State(session),toolProfile:'none'})
      const handle=await agent.startGraphRun(graph,0,{requestId:'restart'});const result=await handle.finished
      expect(result.outcome).eq(checkpoint==='run-terminal'?'completed':'incomplete');expect(result.recording.status).eq('recovered');expect(handle.value()).equal(undefined)
      const {records} = (await inspectExecutionJournal(repository.journalRoot,session.getId())).runs[0]
      const inspection=inspectGraphRun(records,{entries:session.getEntries(),formatVersion:session.formatVersion,sessionId:session.getId()});expect(inspection.issue).equal(undefined)
      expect(await fs.readFile(path.join(root,'dispatches'),'utf8').catch(()=> '')).eq(['graph-node-completed','graph-transition','run-terminal'].includes(checkpoint)?'once\n':'')
      await agent.close();await session.close()
    } finally {await agent?.close();await fs.rm(root,{force:true,recursive:true})}
  })
})
