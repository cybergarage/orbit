// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-process-exit, unicorn/no-process-exit -- Explicit death at the acknowledged checkpoint is the test condition. */

// Exit only after the requested durable acknowledgement; never infer success from a timeout.
import fs from 'node:fs/promises'
import path from 'node:path'

import {Agent, compileProcessorGraph, FileExecutionJournal, MemorySessionLogStore, SessionRepository, State} from '../../../../dist/core/index.js'
const root=process.env.ORBIT_GRAPH_ROOT
const repository=new SessionRepository({journalRoot:path.join(root,'journal'),rootDir:path.join(root,'sessions')})
repository.initializeStorage({allWritersStopped:true,automaticRestartersDisabled:true,exclusiveStorageControl:true})
const session=repository.create({formatVersion:2,id:'interrupted'})
const graph=await compileProcessorGraph({edges:[{from:'first',id:'finish',to:'done'}],entry:'first',id:'interruption',nodes:[{adapter:'copy',id:'first'}],terminals:[{id:'done',outcome:'completed'}]},[{id:'copy',inputSchema:{},async invoke(input){
  // Test-only dispatch instrumentation, not an application effect adapter.
  await fs.appendFile(path.join(root,'dispatches'),'once\n')
  return input
},kind:'transform',outputSchema:{},version:'1'}])
const agent=new Agent({cwd:root,deps:{createModel:()=>({getModel:()=> 'fixture',getName:()=> 'fixture',getProvider:()=> 'ollama',async invoke(){throw new Error('Unexpected model call')}})},execution:{async journalFactory(){
  const journal=await FileExecutionJournal.open(session.getId(),{lease:session.acquireWriterLease(),root:repository.journalRoot})
  const append=journal.append.bind(journal)
  journal.append=async(...args)=>{const record=await append(...args);if(record.kind===process.env.ORBIT_GRAPH_CHECKPOINT)process.exit(73);return record}
  return journal
}},logStore:new MemorySessionLogStore(),state:new State(session),toolProfile:'none'})
await (await agent.startGraphRun(graph,0,{requestId:'restart'})).finished
await agent.close()
process.exit(74)
