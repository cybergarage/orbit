// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {DiagnosticEvent, ThreadStatus} from '../../core/index.js'

export const GuiRunPhase = {
  Cancelled: 'cancelled',
  Failed: 'failed',
  Idle: 'idle',
  Sending: 'sending',
  Stopping: 'stopping',
  Thinking: 'thinking',
  Tool: 'tool',
  Working: 'working',
} as const

export type GuiRunPhase = (typeof GuiRunPhase)[keyof typeof GuiRunPhase]

export interface GuiRunPresentation {
  detail?: string
  phase: GuiRunPhase
  runId?: string
}

export const idleGuiRunPresentation: GuiRunPresentation = {phase: GuiRunPhase.Idle}

export function beginGuiRun(): GuiRunPresentation {
  return {phase: GuiRunPhase.Sending}
}

export function acceptGuiRun(current: GuiRunPresentation, runId: string): GuiRunPresentation {
  if (current.phase === GuiRunPhase.Sending) return {phase: GuiRunPhase.Working, runId}
  return isGuiRunActive(current) ? {...current, runId} : current
}

export function requestGuiRunStop(current: GuiRunPresentation): GuiRunPresentation {
  const runId = activeGuiRunId(current)
  return runId === undefined ? current : {phase: GuiRunPhase.Stopping, runId}
}

export function restoreGuiRunAfterStopFailure(current: GuiRunPresentation): GuiRunPresentation {
  return current.phase === GuiRunPhase.Stopping
    ? {phase: GuiRunPhase.Working, ...(current.runId === undefined ? {} : {runId: current.runId})}
    : current
}

export function updateGuiRunFromEvent(
  current: GuiRunPresentation,
  event: Pick<DiagnosticEvent, 'data' | 'runId' | 'type'>,
): GuiRunPresentation {
  if (current.runId && event.runId && current.runId !== event.runId) return current
  const runId = event.runId ?? current.runId
  switch (event.type) {
    case 'model.started': {
      return {phase: GuiRunPhase.Thinking, ...(runId === undefined ? {} : {runId})}
    }

    case 'run.cancelled': {
      return {phase: GuiRunPhase.Cancelled}
    }

    case 'run.completed': {
      return idleGuiRunPresentation
    }

    case 'run.failed': {
      return {detail: diagnosticErrorMessage(event.data), phase: GuiRunPhase.Failed}
    }

    case 'run.started': {
      return {phase: GuiRunPhase.Working, ...(runId === undefined ? {} : {runId})}
    }

    case 'tool.started': {
      const toolName = typeof event.data.toolName === 'string' ? event.data.toolName : undefined
      return {
        ...(toolName === undefined ? {} : {detail: toolName}),
        phase: GuiRunPhase.Tool,
        ...(runId === undefined ? {} : {runId}),
      }
    }

    default: {
      return current
    }
  }
}

export function reconcileGuiRunWithThread(
  current: GuiRunPresentation | undefined,
  status: ThreadStatus,
): GuiRunPresentation {
  if (status === 'running') {
    return current === undefined || !isGuiRunActive(current) ? {phase: GuiRunPhase.Working} : current
  }

  if (current?.phase === GuiRunPhase.Stopping) return {phase: GuiRunPhase.Cancelled}
  if (current?.phase === GuiRunPhase.Cancelled || current?.phase === GuiRunPhase.Failed) return current
  return idleGuiRunPresentation
}

export function isGuiRunActive(presentation: GuiRunPresentation): boolean {
  return (
    presentation.phase === GuiRunPhase.Sending ||
    presentation.phase === GuiRunPhase.Stopping ||
    presentation.phase === GuiRunPhase.Thinking ||
    presentation.phase === GuiRunPhase.Tool ||
    presentation.phase === GuiRunPhase.Working
  )
}

export function activeGuiRunId(presentation: GuiRunPresentation): string | undefined {
  return isGuiRunActive(presentation) ? presentation.runId : undefined
}

export function guiRunStatusText(presentation: GuiRunPresentation): string | undefined {
  switch (presentation.phase) {
    case GuiRunPhase.Cancelled: {
      return 'Response stopped'
    }

    case GuiRunPhase.Failed: {
      return presentation.detail === undefined
        ? 'Orbit encountered an error'
        : `Orbit encountered an error: ${presentation.detail}`
    }

    case GuiRunPhase.Idle: {
      return undefined
    }

    case GuiRunPhase.Sending: {
      return 'Sending…'
    }

    case GuiRunPhase.Stopping: {
      return 'Stopping Orbit…'
    }

    case GuiRunPhase.Thinking: {
      return 'Orbit is thinking…'
    }

    case GuiRunPhase.Tool: {
      return presentation.detail === undefined ? 'Orbit is working…' : `Orbit is using ${presentation.detail}…`
    }

    case GuiRunPhase.Working: {
      return 'Orbit is working…'
    }
  }
}

function diagnosticErrorMessage(data: Record<string, unknown>): string | undefined {
  if (typeof data.error === 'string') return data.error
  if (typeof data.error !== 'object' || data.error === null) return undefined
  const {message} = data.error as Record<string, unknown>
  return typeof message === 'string' ? message : undefined
}
