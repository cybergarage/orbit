// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Session} from './session.js'

import {Message, MessageType} from '../message/index.js'
import {getToolCalls} from '../models/adapters/tools.js'
import {currentTurnUsers} from './compaction.js'
import {ContextBudgetError} from './context-error.js'

export interface CompactionPlan {
  cut: number
  retained: Message[]
}
export interface CompactionStrategy {
  readonly id: string
  plan(options: {
    all: Message[]
    entries: ReturnType<Session['getEntries']>
    estimateRetained(cut: number, retained: Message[]): number
    graphVisit: boolean
    previousCut: number
    protectedMessageId?: string
    target: number
  }): CompactionPlan
  readonly requiresCumulativeUpdates: boolean
  readonly requiresSingleAction?: boolean
  readonly reset?: boolean
  shouldCompact(input: {completedAction?: boolean; recovery: boolean; tokens: number; trigger: number}): boolean
  readonly summarySchema: string
}

export const budgetedCompactionStrategy: CompactionStrategy = {
  id: 'budgeted-suffix-v1',
  plan(options) {
    const {all, previousCut} = options
    let cut = options.protectedMessageId
      ? all.findIndex((message) => message.id === options.protectedMessageId)
      : all.map((message) => message.type).lastIndexOf(MessageType.User)
    if (options.graphVisit && cut < 0) throw new ContextBudgetError('missing-protected-graph-turn')
    let retained: Message[] = []
    const protectedTokens = () => options.estimateRetained(cut, retained)
    // Keep the newest complete tool round verbatim; only earlier closed groups are eligible.
    const lastRound = all.map((message) => getToolCalls(message).length > 0).lastIndexOf(true)
    if (
      (cut <= previousCut || protectedTokens() > options.target) &&
      lastRound > Math.max(cut, previousCut) &&
      all.slice(Math.max(0, cut), lastRound).some((message) => getToolCalls(message).length > 0)
    ) {
      cut = lastRound
      retained = currentTurnUsers(options.entries, all, cut)
    }

    return {cut, retained}
  },
  requiresCumulativeUpdates: true,
  shouldCompact: ({recovery, tokens, trigger}) => recovery || tokens >= trigger,
  summarySchema: 'context-summary-v1',
}

/** Reset projections preserve canonical user instructions but no raw action history. */
export const eoccCompactionStrategy: CompactionStrategy = {
  id: 'eocc-v1',
  plan: ({all}) => ({cut: all.length, retained: all.filter((message) => message.type === MessageType.User)}),
  requiresCumulativeUpdates: true,
  reset: true,
  shouldCompact: ({recovery, tokens, trigger}) => recovery || tokens >= trigger,
  summarySchema: 'context-summary-v1',
}

export const sacCompactionStrategy: CompactionStrategy = {
  ...eoccCompactionStrategy,
  id: 'sac-v1',
  requiresSingleAction: true,
  shouldCompact: ({completedAction, recovery, tokens, trigger}) =>
    Boolean(completedAction) || recovery || tokens >= trigger,
}
