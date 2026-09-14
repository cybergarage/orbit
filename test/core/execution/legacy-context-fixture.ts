// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import {Message, MessageType, type Session, SkillCatalog} from '../../../src/core/index.js'
import {persistedContextMessage, sourceDigest} from '../../../src/core/session/compaction.js'

/** Valid old Skill and version-1 checkpoint records; migration must not re-encode them. */
export async function seedLegacyContext(session: Session, root: string): Promise<void> {
  const directory = path.join(root, 'skills', 'review')
  await fs.mkdir(directory, {recursive: true})
  await fs.writeFile(
    path.join(directory, 'SKILL.md'),
    '\uFEFF---\r\nname: review\r\ndescription: Review a fixed target\r\n---\r\nOLD_SKILL_BODY\r\n',
  )
  const catalog = new SkillCatalog([{directory: path.dirname(directory), id: 'local'}])
  const listing = await catalog.list()
  const skills = await catalog.resolve(listing.candidates)
  const release = session.acquireManagedLease()
  try {
    session.recordTurnContext({cwd: root, maxToolIterations: 1, model: 'fixed', provider: 'ollama', turnId: 'old'})
    session.recordTurnEvent({phase: 'started', turnId: 'old'})
    const [user] = session.appendMessages([new Message(MessageType.User, {content: 'old task'})], {turnId: 'old'})
    await session.commitSkills(
      {
        id: 'old-skills',
        sessionId: session.getId(),
        skills,
        timestamp: new Date().toISOString(),
        turnId: 'old',
        type: 'skill_context',
        version: 1,
      },
      'file-and-directory-sync',
    )
    const [answer] = session.appendMessages([new Message(MessageType.Assistant, {content: 'old answer'})], {
      turnId: 'old',
    })
    session.recordTurnEvent({phase: 'completed', turnId: 'old'})
    const [latest] = session.appendMessages([new Message(MessageType.User, {content: 'latest turn'})])
    await session.commitCompaction(
      {
        afterTokens: 50,
        beforeTokens: 100,
        digestVersion: 'sha256-json-v1',
        estimatorRevision: 'fixed',
        firstRetainedId: latest.id,
        id: 'old-checkpoint',
        model: 'fixed',
        prefixEndId: answer.id,
        previousId: null,
        profileRevision: 'fixed',
        projectionVersion: 1,
        provider: 'ollama',
        sessionId: session.getId(),
        sourceDigest: sourceDigest(
          session
            .getConversationMessages()
            .slice(0, -1)
            .map((m) => persistedContextMessage(m)),
        ),
        sourceHeadId: latest.id,
        summary: {
          changedPaths: [],
          facts: [],
          goals: [{sourceIds: [user.id], text: 'old task'}],
          tests: [],
          uncertainties: [],
          unfinished: [],
          version: 1,
        },
        timestamp: new Date().toISOString(),
        type: 'compaction',
      },
      'file-and-directory-sync',
    )
  } finally {
    release()
    await catalog.settle()
  }
}
