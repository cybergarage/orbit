// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ProviderName} from '../models/provider.js'
import type {SessionEntry, SessionMetadata, SessionTurnEventEntry} from './entries.js'
import type {Session} from './session.js'

import {SessionEntryType} from './entries.js'

export type SessionStatus = 'cancelled' | 'completed' | 'failed' | 'interrupted' | 'new'

export interface SessionInformation {
  createdAt: string
  cwd: string
  file?: string
  id: string
  model?: string
  originator?: string
  preview?: string
  provider?: ProviderName
  status: SessionStatus
  updatedAt: string
}

export interface SessionInformationOverrides {
  model?: string
  provider?: ProviderName
}

interface SessionInformationSource extends Omit<SessionMetadata, 'rootMessageId' | 'systemPrompt'> {
  entries: SessionEntry[]
}

export function createSessionInformation(
  session: Session,
  overrides: SessionInformationOverrides = {},
): SessionInformation {
  return createSessionInformationFromSource(
    {
      ...session.getMetadata(),
      entries: session.getEntries(),
    },
    overrides,
  )
}

export function createSessionInformationFromSource(
  source: SessionInformationSource,
  overrides: SessionInformationOverrides = {},
): SessionInformation {
  const lastEntry = source.entries.at(-1)
  const previewEntry = source.entries.find(
    (entry) =>
      entry.type === SessionEntryType.Message && entry.message.type === 'user' && entry.message.contents.length > 0,
  )
  const lastTurnEvent = findLastTurnEvent(source.entries)
  const model = overrides.model ?? source.model
  const provider = overrides.provider ?? source.provider
  return {
    createdAt: source.createdAt,
    cwd: source.cwd,
    ...(source.file === undefined ? {} : {file: source.file}),
    id: source.id,
    ...(model === undefined ? {} : {model}),
    ...(source.originator === undefined ? {} : {originator: source.originator}),
    ...(previewEntry?.type === SessionEntryType.Message ? {preview: previewEntry.message.contents[0]} : {}),
    ...(provider === undefined ? {} : {provider}),
    status: sessionStatus(source.entries, lastTurnEvent),
    updatedAt: lastEntry?.timestamp ?? source.createdAt,
  }
}

export function formatSessionInformation(information: SessionInformation): string {
  const lines = [
    `Session ID: ${information.id}`,
    `Status: ${information.status}`,
    `Created: ${information.createdAt}`,
    `Updated: ${information.updatedAt}`,
    `Working directory: ${information.cwd}`,
    `Originator: ${information.originator ?? 'not recorded'}`,
    `Provider: ${information.provider ?? 'not recorded'}`,
    `Model: ${information.model ?? 'not recorded'}`,
    `Transcript file: ${information.file ?? 'not persisted'}`,
  ]
  if (information.preview !== undefined) lines.push(`Preview: ${information.preview}`)
  return lines.join('\n')
}

function findLastTurnEvent(entries: SessionEntry[]): SessionTurnEventEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === SessionEntryType.TurnEvent) return entry
  }
}

function sessionStatus(entries: SessionEntry[], lastTurnEvent: SessionTurnEventEntry | undefined): SessionStatus {
  if (lastTurnEvent?.phase === 'cancelled') return 'cancelled'
  if (lastTurnEvent?.phase === 'completed') return 'completed'
  if (lastTurnEvent?.phase === 'failed') return 'failed'
  if (entries.length > 0) return 'interrupted'
  return 'new'
}
