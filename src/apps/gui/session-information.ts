// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {SessionSummary, ThreadSnapshot} from '../../core/index.js'

export interface ClipboardWriter {
  writeText(value: string): Promise<void>
}

export function selectedSessionSummary(
  thread: ThreadSnapshot | undefined,
  sessions: SessionSummary[],
): SessionSummary | undefined {
  if (thread === undefined) return
  const saved = sessions.find((session) => session.id === thread.id)
  const file = thread.file ?? saved?.file
  if (file === undefined) return
  const model = thread.model ?? saved?.model
  const provider = thread.provider ?? saved?.provider
  const titleSource = (saved?.titleRevision ?? -1) >= (thread.titleRevision ?? -1) ? saved : thread
  return {
    createdAt: saved?.createdAt ?? thread.createdAt,
    cwd: thread.cwd,
    file,
    id: thread.id,
    ...(titleSource?.title === undefined ? {} : {title: titleSource.title}),
    titleRevision: titleSource?.titleRevision ?? 0,
    ...(model === undefined ? {} : {model}),
    ...(saved?.originator === undefined ? {} : {originator: saved.originator}),
    ...(saved?.preview === undefined ? {} : {preview: saved.preview}),
    ...(provider === undefined ? {} : {provider}),
    status: saved?.status ?? 'new',
    updatedAt: thread.updatedAt,
  }
}

export async function copySessionId(session: SessionSummary, clipboard: ClipboardWriter): Promise<void> {
  await clipboard.writeText(session.id)
}
