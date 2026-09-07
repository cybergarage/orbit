// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {
  acceptGuiRun,
  activeGuiRunId,
  beginGuiRun,
  GuiRunPhase,
  guiRunStatusText,
  isGuiRunActive,
  reconcileGuiRunWithThread,
  requestGuiRunStop,
  restoreGuiRunAfterStopFailure,
  updateGuiRunFromEvent,
} from '../../../src/apps/gui/run-presentation.js'

describe('GUI run presentation', () => {
  it('ignores a delayed terminal notification from a previous run', () => {
    const current = {phase: GuiRunPhase.Thinking, runId: 'current'}
    expect(updateGuiRunFromEvent(current, {data: {}, runId: 'previous', type: 'run.completed'})).deep.equal(current)
  })

  it('ignores a delayed start from a previous run while the new run is active', () => {
    const current = {phase: GuiRunPhase.Thinking, runId: 'current'}
    expect(updateGuiRunFromEvent(current, {data: {}, runId: 'previous', type: 'run.started'})).deep.equal(current)
  })

  it('presents submission, model, and tool phases with one active run ID', () => {
    const sending = beginGuiRun()
    const accepted = acceptGuiRun(sending, 'run-1')
    const thinking = updateGuiRunFromEvent(accepted, {
      data: {},
      runId: 'run-1',
      type: 'model.started',
    })
    const tool = updateGuiRunFromEvent(thinking, {
      data: {toolName: 'bash'},
      runId: 'run-1',
      type: 'tool.started',
    })

    expect(guiRunStatusText(sending)).to.equal('Sending…')
    expect(guiRunStatusText(accepted)).to.equal('Orbit is working…')
    expect(guiRunStatusText(thinking)).to.equal('Orbit is thinking…')
    expect(guiRunStatusText(tool)).to.equal('Orbit is using bash…')
    expect(activeGuiRunId(tool)).to.equal('run-1')
    expect(isGuiRunActive(tool)).to.equal(true)
  })

  it('presents stopping, cancellation, and stop request failures', () => {
    const accepted = acceptGuiRun(beginGuiRun(), 'run-1')
    const stopping = requestGuiRunStop(accepted)
    const restored = restoreGuiRunAfterStopFailure(stopping)
    const cancelled = updateGuiRunFromEvent(stopping, {
      data: {},
      runId: 'run-1',
      type: 'run.cancelled',
    })

    expect(stopping).to.deep.equal({phase: GuiRunPhase.Stopping, runId: 'run-1'})
    expect(guiRunStatusText(stopping)).to.equal('Stopping Orbit…')
    expect(restored).to.deep.equal({phase: GuiRunPhase.Working, runId: 'run-1'})
    expect(guiRunStatusText(cancelled)).to.equal('Response stopped')
    expect(isGuiRunActive(cancelled)).to.equal(false)
  })

  it('presents background failures and preserves terminal state during refresh', () => {
    const failed = updateGuiRunFromEvent(acceptGuiRun(beginGuiRun(), 'run-1'), {
      data: {error: {message: 'provider unavailable', name: 'Error'}},
      runId: 'run-1',
      type: 'run.failed',
    })

    expect(guiRunStatusText(failed)).to.equal('Orbit encountered an error: provider unavailable')
    expect(acceptGuiRun(failed, 'run-1')).to.equal(failed)
    expect(reconcileGuiRunWithThread(failed, 'idle')).to.equal(failed)
  })

  it('recovers working and cancelled presentation from thread status', () => {
    const recovered = reconcileGuiRunWithThread(undefined, 'running')
    const cancelled = reconcileGuiRunWithThread({phase: GuiRunPhase.Stopping, runId: 'run-1'}, 'idle')

    expect(recovered).to.deep.equal({phase: GuiRunPhase.Working})
    expect(cancelled).to.deep.equal({phase: GuiRunPhase.Cancelled})
  })
})
