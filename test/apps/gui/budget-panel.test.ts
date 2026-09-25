// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import type {RunSnapshot} from '../../../src/core/execution/run.js'

import {BudgetPanel, budgetStatus, canContinueBudget} from '../../../src/apps/gui/budget-panel.js'
import {DEFAULT_RUN_LIMITS} from '../../../src/core/execution/limits.js'

const snapshot = (): RunSnapshot => ({
  approvals: [],
  budget: {modelCalls: 6, toolRequests: 10, toolRounds: 5},
  phase: 'terminal',
  quarantined: false,
  result: {
    cleanupErrors: [],
    operations: [],
    outcome: 'budget-exceeded',
    quiescence: true,
    reason: 'budget-exceeded:toolRounds:5:5:1',
    recording: {level: 'memory', mode: 'memory', status: 'acknowledged'},
    runId: 'old',
    sessionId: 'session',
    unresolved: [],
  },
  runId: 'old',
  sequence: 10,
  sessionId: 'session',
  unresolved: [],
  version: 1,
})

describe('GUI budget continuation', () => {
  it('renders actionable limit details, editable limits and an explicit continuation', () => {
    const html = renderToStaticMarkup(
      createElement(BudgetPanel, {
        active: false,
        limits: DEFAULT_RUN_LIMITS,
        onChange() {},
        onContinue() {},
        snapshot: snapshot(),
      }),
    )
    expect(html).contain('5 used, 5 allowed')
    expect(html).contain('Continue with these limits')
    expect(html).contain('does not replay the stopped tool call')
    expect(html).contain('aria-label="Tool rounds"')
    expect(html).not.contain('disabled=""')
  })

  it('supports recovered evidence but disables continuation for unknown work or failed recording', () => {
    const state = snapshot()
    state.result!.recording.status = 'recovered'
    expect(canContinueBudget(state)).equal(true)
    state.result!.recording.status = 'failed'
    expect(canContinueBudget(state)).equal(false)
    state.result!.recording.status = 'acknowledged'
    state.result!.quiescence = false
    expect(canContinueBudget(state)).equal(false)
    state.result!.quiescence = true
    state.quarantined = true
    expect(canContinueBudget(state)).equal(false)
    state.result!.reason = 'budget-exceeded'
    expect(budgetStatus(state)).contain('run limit was reached')
  })
})
