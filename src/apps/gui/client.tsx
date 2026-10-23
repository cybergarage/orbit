// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-unsupported-features/node-builtins */
/* global document, EventSource, fetch, HTMLButtonElement, HTMLDivElement, HTMLElement, HTMLMetaElement, KeyboardEvent, MessageEvent, navigator, RequestInit, window */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'

import type {RunLimits} from '../../core/execution/limits.js'
import type {
  DiagnosticCapture,
  DiagnosticEvent,
  GuiPreferences,
  LogPage,
  LogRecord,
  Project,
  ProjectMembership,
  ProjectMemorySelection,
  RuntimeSnapshot,
  SessionSummary,
  SkillListing,
  SkillSelection,
  StartApplicationRunResult,
  ThreadMessage,
  ThreadSnapshot,
} from '../../core/index.js'

import {DEFAULT_RUN_LIMITS, parseRunLimits} from '../../core/execution/limits.js'
import {sessionDisplayName} from '../../core/session/information.js'
import {ApprovalDialog} from './approval-dialog.js'
import {BudgetPanel, budgetStatus, canContinueBudget} from './budget-panel.js'
import {Icon} from './icons.js'
import {ProjectMemoryPanel} from './project-memory-panel.js'
import {
  acceptGuiRun,
  activeGuiRunId,
  beginGuiRun,
  GuiRunPhase,
  type GuiRunPresentation,
  guiRunStatusText,
  idleGuiRunPresentation,
  isGuiRunActive,
  reconcileGuiRunWithThread,
  requestGuiRunStop,
  restoreGuiRunAfterStopFailure,
  updateGuiRunFromEvent,
} from './run-presentation.js'
import {copySessionId, selectedSessionSummary} from './session-information.js'
import {Sidebar} from './sidebar.js'
import {Brand, ScheduledWorkspace, SettingsWorkspace} from './workspaces.js'

const token = document.querySelector<HTMLMetaElement>('meta[name="orbit-token"]')?.content ?? ''

// Session selection coordinates conversation, backfill, live logs, and deletion in one renderer boundary.
// eslint-disable-next-line complexity
function App() {
  const [page, setPage] = useState('home')
  const [drawer, setDrawer] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const receiveProjects = useCallback((updated: Project[]) => {
    setProjects((current) => [
      ...current.filter((project) => !updated.some((item) => item.id === project.id)),
      ...updated,
    ])
  }, [])
  const detailsButton = useRef<HTMLButtonElement>(null)
  const detailsPanel = useRef<HTMLElement>(null)
  const [dismissedApproval, setDismissedApproval] = useState<Set<string>>(new Set())
  const [approvalBusy, setApprovalBusy] = useState(false)
  const approvalPending = useRef(new Set<string>())
  const [clock, setClock] = useState(Date.now())
  const closeDetails = useCallback(() => {
    setDetailsOpen(false)
    detailsButton.current?.focus()
  }, [])
  useEffect(() => {
    if (detailsOpen) detailsPanel.current?.focus()
  }, [detailsOpen])
  const samplePending = useRef(false)
  const preferencesPending = useRef(false)
  const [preferencesBusy, setPreferencesBusy] = useState(false)
  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role=menu], [role=dialog]')) {
        setDrawer(false)
        setDetailsOpen(false)
        detailsButton.current?.focus()
      }
    }

    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [])
  useEffect(() => {
    if (!drawer) return
    const sidebar = [...document.querySelectorAll<HTMLElement>('.sidebar')].find(
      (element) => element.getClientRects().length > 0,
    )
    sidebar?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    return () => {
      const toggle = document.querySelector<HTMLElement>('.drawer-toggle')
      if (toggle?.getClientRects().length) toggle.focus()
    }
  }, [drawer])
  const [runtime, setRuntime] = useState<RuntimeSnapshot>()
  const [contextNotices, setContextNotices] = useState<Record<string, string>>({})
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [projectsEnabled, setProjectsEnabled] = useState(false)
  const [sidebarRevision, setSidebarRevision] = useState(0)
  const [membership, setMembership] = useState<null | ProjectMembership>(null)
  const [membershipThread, setMembershipThread] = useState<string>()
  const [memorySelections, setMemorySelections] = useState<Record<string, ProjectMemorySelection>>({})
  const catalogOperations = useRef(new Map<string, string>())
  const operationId = (key: string) => {
    if (!catalogOperations.current.has(key)) catalogOperations.current.set(key, crypto.randomUUID())
    return catalogOperations.current.get(key)!
  }

  const [thread, setThread] = useState<ThreadSnapshot>()
  useEffect(() => {
    if (!thread?.run?.approvals.length) return
    setClock(Date.now())
    const timer = globalThis.setInterval(() => setClock(Date.now()), 1000)
    return () => globalThis.clearInterval(timer)
  }, [thread?.run?.approvals.length])
  useEffect(() => setSkillHistory(''), [thread?.id])
  const [logs, setLogs] = useState<LogRecord[]>([])
  const [preferences, setPreferences] = useState<GuiPreferences>({
    debugPanelVisible: true,
    diagnosticCapture: 'metadata',
  })
  const [skillList, setSkillList] = useState<SkillListing>({candidates: [], complete: true, issues: []})
  const [pendingSkills, setPendingSkills] = useState<Record<string, SkillSelection[]>>({})
  const [skillHistory, setSkillHistory] = useState('')
  const [prompt, setPrompt] = useState('')
  const [limitOverrides, setLimitOverrides] = useState<Record<string, Partial<RunLimits>>>({})
  const nextLimits = {
    ...DEFAULT_RUN_LIMITS,
    ...runtime?.executionLimits,
    ...thread?.executionLimits,
    ...limitOverrides[thread?.id ?? ''],
  }

  const [runPresentations, setRunPresentations] = useState<Record<string, GuiRunPresentation>>({})
  const [error, setError] = useState<string>()
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [eventFilter, setEventFilter] = useState('all')
  const [sessionMenu, setSessionMenu] = useState<{session: SessionSummary; x: number; y: number}>()
  const [sessionToInspect, setSessionToInspect] = useState<SessionSummary>()
  const [sessionToDelete, setSessionToDelete] = useState<SessionSummary>()
  const [notice, setNotice] = useState<string>()
  const messagesEnd = useRef<HTMLDivElement>(null)
  const pendingSubmissions = useRef(new Set<string>())
  const sessionDetailsReturnFocus = useRef<HTMLElement | null>(null)
  const runSequences = useRef(new Map<string, number>())
  const refreshVersions = useRef(new Map<string, number>())
  const selectedThreadId = useRef<string | undefined>(undefined)

  const receiveSessions = useCallback((updated: SessionSummary[]) => {
    setSessions(updated)
    setSessionToInspect((current) => updated.find((item) => item.id === current?.id) ?? current)
  }, [])

  const loadSessions = useCallback(async () => setSidebarRevision((current) => current + 1), [])

  const refreshThread = useCallback(async (threadId: string) => {
    const revision = (refreshVersions.current.get(threadId) ?? 0) + 1
    refreshVersions.current.set(threadId, revision)
    const next = await api<ThreadSnapshot>(`/api/threads/${encodeURIComponent(threadId)}`)
    if (refreshVersions.current.get(threadId) !== revision) return
    if (selectedThreadId.current === threadId)
      setThread((current) =>
        current?.run?.runId === next.run?.runId && (current?.run?.sequence ?? 0) > (next.run?.sequence ?? 0)
          ? current
          : next,
      )
    setRunPresentations((current) => ({
      ...current,
      [threadId]:
        next.run && !next.run.result
          ? {...reconcileGuiRunWithThread(current[threadId], next.status), runId: next.run.runId}
          : reconcileGuiRunWithThread(current[threadId], next.status),
    }))
  }, [])

  useEffect(() => {
    Promise.all([
      api<RuntimeSnapshot>('/api/runtime').then(setRuntime),
      api<SkillListing>('/api/skills').then(setSkillList),
      api<GuiPreferences>('/api/preferences').then(setPreferences),
      loadSessions(),
    ]).catch(showError(setError))

    const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
    source.addEventListener('run-snapshot', (message) => {
      const snapshot = JSON.parse((message as MessageEvent).data) as import('../../core/index.js').RunSnapshot
      if ((runSequences.current.get(snapshot.runId) ?? -1) >= snapshot.sequence) return
      runSequences.current.set(snapshot.runId, snapshot.sequence)
      // Always query authoritative state, including gaps and terminal transitions.
      if (selectedThreadId.current === snapshot.sessionId) refreshThread(snapshot.sessionId).catch(() => {})
    })
    source.addEventListener('diagnostic', (message) => {
      const event = JSON.parse((message as MessageEvent).data) as DiagnosticEvent
      if (event.type === 'context.prepared' && event.threadId) {
        const id = event.threadId
        setContextNotices((current) => ({
          ...current,
          [id]:
            event.data?.outcome === 'compacted'
              ? 'Conversation compacted'
              : 'Compaction failed; original context retained',
        }))
      }

      if (event.threadId !== undefined) {
        const {threadId} = event
        setRunPresentations((current) => ({
          ...current,
          [threadId]: updateGuiRunFromEvent(current[threadId] ?? idleGuiRunPresentation, event),
        }))
      }

      if (event.threadId !== undefined && event.threadId === selectedThreadId.current)
        refreshThread(event.threadId).catch(() => {})
      if (
        event.type === 'project.changed' ||
        event.type === 'session.renamed' ||
        event.type === 'run.completed' ||
        event.type === 'session.created' ||
        event.type === 'session.resumed'
      ) {
        loadSessions().catch(() => {})
      }
    })
    source.addEventListener('log', (message) => {
      const record = JSON.parse((message as MessageEvent).data) as LogRecord
      if (record.correlation.sessionId !== selectedThreadId.current) return
      setLogs((current) => appendUniqueLog(current, record))
    })
    source.addEventListener('open', () => {
      loadSessions().catch(showError(setError))
      setError((current) => (current === 'The event stream disconnected. Reconnecting…' ? undefined : current))
      if (selectedThreadId.current) refreshThread(selectedThreadId.current).catch(() => {})
    })
    source.addEventListener('error', () => setError('The event stream disconnected. Reconnecting…'))
    return () => source.close()
  }, [loadSessions, refreshThread])

  useEffect(() => {
    selectedThreadId.current = thread?.id
    setLogs([])
    if (thread === undefined) {
      setMembership(null)
      return
    }

    const threadId = thread.id
    api<SkillListing>(`/api/skills?threadId=${encodeURIComponent(threadId)}`)
      .then((listing) => {
        if (selectedThreadId.current === threadId) setSkillList(listing)
      })
      .catch(showError(setError))
    api<{membership: null | ProjectMembership}>(`/api/sessions/${encodeURIComponent(threadId)}/membership`)
      .then((result) => {
        if (selectedThreadId.current === threadId) {
          setMembership(result.membership)
          setMembershipThread(threadId)
        }
      })
      .catch(showError(setError))
    api<LogPage>(`/api/sessions/${encodeURIComponent(threadId)}/logs?limit=200`)
      .then((page) => {
        if (selectedThreadId.current === threadId) {
          setLogs((current) => mergeLogs(page.data, current))
        }
      })
      .catch(showError(setError))
  }, [thread?.id])

  useEffect(() => {
    if (thread?.messages.length || runStatus !== undefined) messagesEnd.current?.scrollIntoView({behavior: 'smooth'})
  }, [thread?.messages.length])

  useEffect(() => {
    if (notice === undefined) return
    const timeout = globalThis.setTimeout(() => setNotice(undefined), 2400)
    return () => globalThis.clearTimeout(timeout)
  }, [notice])

  const createThread = async (selectedProject: null | string) => {
    try {
      setError(undefined)
      const key = `thread:${selectedProject ?? 'unassigned'}`
      const created = selectedProject
        ? await api<ThreadSnapshot>(`/api/projects/${encodeURIComponent(selectedProject)}/threads`, {
            body: JSON.stringify({operationId: operationId(key)}),
            headers: {'Content-Type': 'application/json'},
            method: 'POST',
          })
        : await api<ThreadSnapshot>('/api/threads', {method: 'POST'})
      catalogOperations.current.delete(key)
      selectedThreadId.current = created.id
      setThread(created)
      setRunPresentations((current) => ({
        ...current,
        [created.id]: reconcileGuiRunWithThread(current[created.id], created.status),
      }))
      await loadSessions()
    } catch (nextError) {
      showError(setError)(nextError)
    }
  }

  const selectSession = async (session: SessionSummary, selectedProject: null | string) => {
    try {
      setError(undefined)
      selectedThreadId.current = session.id
      setLogs([])
      const resumed = await api<ThreadSnapshot>(
        `${selectedProject ? `/api/projects/${encodeURIComponent(selectedProject)}` : '/api'}/sessions/${encodeURIComponent(session.id)}/resume`,
        {
          method: 'POST',
        },
      )
      if (selectedThreadId.current !== session.id) return
      setThread(resumed)
      setRunPresentations((current) => ({
        ...current,
        [resumed.id]: reconcileGuiRunWithThread(current[resumed.id], resumed.status),
      }))
    } catch (nextError) {
      showError(setError)(nextError)
    }
  }

  const deleteSession = async (session: SessionSummary) => {
    setSessionToDelete(undefined)
    try {
      setError(undefined)
      await api(`/api/sessions/${encodeURIComponent(session.id)}`, {method: 'DELETE'})
      if (thread?.id === session.id) {
        setThread(undefined)
        setLogs([])
      }

      setRunPresentations((current) => {
        const next = {...current}
        delete next[session.id]
        return next
      })

      await loadSessions()
    } catch (nextError) {
      showError(setError)(nextError)
    }
  }

  const replyApproval = async (requestId: string, digest: string, approve: boolean) => {
    if (!thread?.run || approvalPending.current.has(requestId)) return
    const request = thread.run.approvals.find((item) => item.id === requestId)
    if (!request || request.expiresAt <= Date.now()) return
    approvalPending.current.add(requestId)
    setApprovalBusy(true)
    try {
      await api(`/api/runs/${encodeURIComponent(thread.run.runId)}/approvals`, {
        body: JSON.stringify({approve, digest, requestId}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      await refreshThread(thread.id)
    } catch (nextError) {
      showError(setError)(nextError)
      await refreshThread(thread.id).catch(() => {})
    } finally {
      approvalPending.current.delete(requestId)
      setApprovalBusy(false)
    }
  }

  const retrySubmission = useRef<
    undefined | {content: string; requestId: string; selectionKey: string; threadId: string}
  >(undefined)
  const submit = async (continueFromRunId?: string) => {
    if (
      thread === undefined ||
      (!continueFromRunId && prompt.trim().length === 0) ||
      (projectsEnabled && membershipThread !== thread.id)
    )
      return
    const threadId = thread.id
    const presentation = runPresentations[threadId] ?? reconcileGuiRunWithThread(undefined, thread.status)
    if (isGuiRunActive(presentation) || pendingSubmissions.current.has(threadId)) return
    const content =
      prompt.trim() ||
      'Continue the unfinished task, respecting the original constraints. Reassess the current state before taking any action.'
    const skills = content.startsWith('/') ? [] : (pendingSkills[threadId] ?? [])
    const memory = membership?.projectId
      ? (memorySelections[threadId] ?? {mode: 'automatic' as const})
      : {mode: 'off' as const}
    const limits = {...limitOverrides[threadId]}
    const selectionKey = JSON.stringify({continueFromRunId, limits, memory, skills})
    pendingSubmissions.current.add(threadId)
    try {
      parseRunLimits(limits)
      setError(undefined)
      setPrompt('')
      setRunPresentations((current) => ({...current, [threadId]: beginGuiRun()}))
      const result = await api<StartApplicationRunResult>(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
        body: JSON.stringify({
          content,
          continueFromRunId,
          limits,
          memory,
          requestId: (() => {
            const prior = retrySubmission.current
            if (
              !prior ||
              prior.content !== content ||
              prior.threadId !== threadId ||
              prior.selectionKey !== selectionKey
            )
              retrySubmission.current = {content, requestId: crypto.randomUUID(), selectionKey, threadId}
            return retrySubmission.current!.requestId
          })(),
          skills,
        }),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      setRunPresentations((current) => ({
        ...current,
        [threadId]:
          result.kind === 'run'
            ? acceptGuiRun(current[threadId] ?? idleGuiRunPresentation, result.runId)
            : idleGuiRunPresentation,
      }))
      if (result.kind === 'run') setPendingSkills((current) => ({...current, [threadId]: []}))
      retrySubmission.current = undefined
      await refreshThread(result.threadId)
    } catch (nextError) {
      setPrompt((current) => (current.length === 0 ? content : `${content}\n${current}`))
      setRunPresentations((current) => ({...current, [threadId]: idleGuiRunPresentation}))
      showError(setError)(nextError)
      await refreshThread(threadId).catch(() => {})
    } finally {
      pendingSubmissions.current.delete(threadId)
    }
  }

  const stop = async () => {
    if (thread === undefined) return
    const threadId = thread.id
    const presentation = runPresentations[threadId] ?? idleGuiRunPresentation
    const runId = activeGuiRunId(presentation)
    if (runId === undefined) return
    setRunPresentations((current) => ({
      ...current,
      [threadId]: requestGuiRunStop(current[threadId] ?? presentation),
    }))
    try {
      await api(`/api/runs/${encodeURIComponent(runId)}/cancel`, {method: 'POST'})
    } catch (nextError) {
      setRunPresentations((current) => ({
        ...current,
        [threadId]: restoreGuiRunAfterStopFailure(current[threadId] ?? presentation),
      }))
      showError(setError)(nextError)
    }
  }

  const updatePreferences = async (update: Partial<GuiPreferences>) => {
    if (preferencesPending.current) return
    preferencesPending.current = true
    setPreferencesBusy(true)
    try {
      const next = await api<GuiPreferences>('/api/preferences', {
        body: JSON.stringify(update),
        headers: {'Content-Type': 'application/json'},
        method: 'PATCH',
      })
      setPreferences(next)
    } catch (nextError) {
      showError(setError)(nextError)
    } finally {
      preferencesPending.current = false
      setPreferencesBusy(false)
    }
  }

  const openSessionDetails = (session: SessionSummary) => {
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.context-menu') === null) {
      sessionDetailsReturnFocus.current = document.activeElement
    }

    setSessionToInspect(session)
    api<SessionSummary>(`/api/sessions/${encodeURIComponent(session.id)}`)
      .then((updated) => setSessionToInspect((current) => (current?.id === updated.id ? updated : current)))
      .catch(showError(setError))
  }

  const copyId = async (session: SessionSummary) => {
    try {
      await copySessionId(session, navigator.clipboard)
      setNotice('Session ID copied')
      if (sessionToInspect === undefined) globalThis.setTimeout(() => sessionDetailsReturnFocus.current?.focus(), 0)
    } catch {
      if (sessionToInspect === undefined) openSessionDetails(session)
      setError('Could not copy the session ID. Select the full ID in Session details and copy it manually.')
    }
  }

  const closeSessionDetails = useCallback(() => {
    setSessionToInspect(undefined)
    globalThis.setTimeout(() => sessionDetailsReturnFocus.current?.focus(), 0)
  }, [])

  const visibleLogs = useMemo(
    () =>
      logs.filter(
        (record) =>
          (eventFilter === 'all' || record.level === eventFilter) &&
          (categoryFilter === 'all' || record.category === categoryFilter),
      ),
    [categoryFilter, eventFilter, logs],
  )
  const selectedSession = useMemo(() => selectedSessionSummary(thread, sessions), [sessions, thread])
  const runPresentation =
    thread === undefined
      ? idleGuiRunPresentation
      : (runPresentations[thread.id] ?? reconcileGuiRunWithThread(undefined, thread.status))
  const runActive = isGuiRunActive(runPresentation)
  const runStatus = guiRunStatusText(runPresentation)
  const runId = activeGuiRunId(runPresentation)
  const selectedThreadIdValue = thread?.id

  useEffect(() => {
    if (selectedThreadIdValue === undefined || !runActive || runPresentation.phase === GuiRunPhase.Sending) return
    const interval = globalThis.setInterval(() => refreshThread(selectedThreadIdValue).catch(() => {}), 1000)
    return () => globalThis.clearInterval(interval)
  }, [refreshThread, runActive, runPresentation.phase, selectedThreadIdValue])

  return (
    <main
      className={`app page-${page} ${drawer ? 'drawer-open' : ''} ${detailsOpen && page === 'home' ? 'details-open' : ''}`}
    >
      {page !== 'home' && error && (
        <div className="global-error-banner error-banner" role="alert">
          {error}
        </div>
      )}
      <nav aria-label="Primary navigation" className="primary-navigation">
        {(['home', 'scheduled', 'settings'] as const).map((value) => (
          <button
            aria-current={page === value ? 'page' : undefined}
            key={value}
            onClick={() => {
              setPage(value)
              setDrawer(false)
            }}
          >
            <Icon name={value === 'scheduled' ? 'schedule' : value} />
            <span>{value[0].toUpperCase() + value.slice(1)}</span>
          </button>
        ))}
      </nav>
      <button
        aria-expanded={drawer}
        aria-label="Toggle context list"
        className="drawer-toggle"
        onClick={() => setDrawer(!drawer)}
      >
        <Icon name="chat" />
        {page === 'home' ? 'Chats' : page === 'scheduled' ? 'Tasks' : 'Settings'}
      </button>
      {drawer && (
        <button aria-label="Dismiss context list" className="drawer-backdrop" onClick={() => setDrawer(false)} />
      )}
      {page === 'scheduled' && <ScheduledWorkspace api={api} closeDrawer={() => setDrawer(false)} />}
      {page === 'settings' && (
        <SettingsWorkspace
          api={api}
          busy={preferencesBusy}
          closeDrawer={() => setDrawer(false)}
          preferences={preferences}
          runtime={runtime}
          update={updatePreferences}
        />
      )}
      <div className="home-workspace" style={{display: page === 'home' ? 'contents' : 'none'}}>
        <aside className="pane sidebar">
          <Brand />
          <Sidebar
            api={api}
            onCopy={(session) => copyId(session).catch(showError(setError))}
            onCreate={createThread}
            onDelete={setSessionToDelete}
            onDetails={openSessionDetails}
            onEnabled={setProjectsEnabled}
            onMenuClosed={() => setSessionMenu(undefined)}
            onMoved={async (sessionId, nextMembership) => {
              if (selectedThreadId.current === sessionId) {
                // Membership changes close the idle host thread; reopen it before the next send.
                setMembershipThread(undefined)
                const resumed = await api<ThreadSnapshot>(
                  `${nextMembership.projectId ? `/api/projects/${encodeURIComponent(nextMembership.projectId)}` : '/api'}/sessions/${encodeURIComponent(sessionId)}/resume`,
                  {method: 'POST'},
                )
                if (selectedThreadId.current !== sessionId) return
                setThread(resumed)
                setMembership(nextMembership)
                setMembershipThread(sessionId)
                setMemorySelections((current) => {
                  const next = {...current}
                  delete next[sessionId]
                  return next
                })
              }

              setNotice('Conversation moved. Its directory and history were retained.')
            }}
            onProjects={receiveProjects}
            onRememberFocus={(element) => {
              sessionDetailsReturnFocus.current = element
            }}
            onRenamed={async (session) => {
              setSessions((current) => [...current.filter((item) => item.id !== session.id), session])
              setSessionToInspect((current) => (current?.id === session.id ? session : current))
              if (selectedThreadId.current === session.id) await refreshThread(session.id)
            }}
            onSelect={async (session, projectId) => {
              await selectSession(session, projectId)
              setDrawer(false)
            }}
            onSessions={receiveSessions}
            requestedMenu={sessionMenu}
            revision={sidebarRevision}
            selectedId={thread?.id}
          />
        </aside>

        <section className="pane conversation">
          <header className="topbar">
            <div className="conversation-heading">
              <div className="title">{thread === undefined ? 'New chat' : sessionTitle(thread, sessions)}</div>
              <div className="muted">
                {membershipThread === thread?.id && membership?.projectId
                  ? (projects.find((project) => project.id === membership.projectId)?.name ?? 'Project')
                  : 'Unassigned'}
              </div>
            </div>
            <div className="topbar-actions">
              <button
                aria-controls="conversation-details"
                aria-expanded={detailsOpen}
                aria-label="Logs"
                className="icon-button"
                onClick={() => (detailsOpen ? closeDetails() : setDetailsOpen(true))}
                ref={detailsButton}
                title="Logs"
                type="button"
              >
                <Icon name="logs" />
              </button>
              {selectedSession === undefined ? null : (
                <button
                  aria-expanded={sessionMenu?.session.id === selectedSession.id}
                  aria-haspopup="menu"
                  aria-label="Session actions"
                  className="icon-button"
                  onClick={(event) => {
                    event.stopPropagation()
                    sessionDetailsReturnFocus.current = event.currentTarget
                    const bounds = event.currentTarget.getBoundingClientRect()
                    setSessionMenu({
                      session: selectedSession,
                      x: Math.max(8, Math.min(bounds.right - 196, window.innerWidth - 204)),
                      y: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 230)),
                    })
                  }}
                  title="Session actions"
                  type="button"
                >
                  <Icon name="more" />
                </button>
              )}
            </div>
          </header>
          {error === undefined ? null : <div className="error-banner">{error}</div>}
          {thread?.run?.approvals.length ? (
            <div className="important-status">
              <output>Approval required · Run paused</output>
              <button className="outlined" onClick={() => setDismissedApproval(new Set())}>
                Review operation
              </button>
            </div>
          ) : null}
          {thread?.run?.result &&
            (thread.run.result.outcome !== 'completed' ||
              thread.run.result.recording.status === 'failed' ||
              !thread.run.result.quiescence) && (
              <div className="important-status">
                <output>
                  {thread.run.result.outcome === 'budget-exceeded'
                    ? budgetStatus(thread.run)
                    : `Run: ${thread.run.result.outcome}.`}{' '}
                  {thread.run.result.quiescence
                    ? ''
                    : 'Work may still be active; conflicting resources remain reserved.'}
                  {thread.run.result.recording.status === 'failed'
                    ? ' Recording failed. Inspect logs before continuing.'
                    : ''}
                </output>
                {thread.run.result.outcome === 'budget-exceeded' && (
                  <button className="outlined" onClick={() => setDetailsOpen(true)}>
                    Review limits
                  </button>
                )}
                {canContinueBudget(thread.run) && (
                  <button
                    className="outlined"
                    disabled={runActive}
                    onClick={() => submit(thread.run?.runId).catch(showError(setError))}
                  >
                    Continue with next-run limits
                  </button>
                )}
              </div>
            )}
          <div aria-busy={runActive} className="messages">
            {thread === undefined || (thread.messages.length === 0 && runStatus === undefined) ? (
              <div className="empty">
                <div className="empty-content">
                  <p>Start a conversation, or reopen a saved chat from your project.</p>
                  <button
                    className="sample-task"
                    onClick={async () => {
                      if (samplePending.current) return
                      samplePending.current = true
                      try {
                        if (!thread) await createThread(null)
                        setPrompt('Review the local GUI and suggest the smallest useful interface.')
                      } finally {
                        samplePending.current = false
                      }
                    }}
                  >
                    Start with a sample task
                  </button>
                  <p className="muted">
                    Project context and settings stay close. Details open only when you need them.
                  </p>
                </div>
              </div>
            ) : (
              thread.messages.map((message) => <MessageView key={message.id} message={message} />)
            )}
            {runStatus === undefined ? null : (
              <div aria-live="polite" className={`run-status ${runPresentation.phase}`} role="status">
                <div className="message-label">Orbit</div>
                <div className="run-status-body">
                  {runActive ? <span aria-hidden="true" className="run-status-dot" /> : null}
                  <span>{runStatus}</span>
                </div>
              </div>
            )}
            <div ref={messagesEnd} />
          </div>
          <div className="composer-wrap">
            <div className={`composer ${runActive ? 'drafting' : ''}`}>
              <textarea
                aria-describedby="composer-instructions"
                aria-label="Message Orbit"
                disabled={thread === undefined}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !runActive) {
                    event.preventDefault()
                    submit().catch(() => {})
                  }
                }}
                placeholder={
                  thread === undefined
                    ? 'Create or select a chat first'
                    : runActive
                      ? 'Draft your next message…'
                      : 'Ask Orbit to help with this project…'
                }
                value={prompt}
              />
              <div className="composer-actions">
                <span id="composer-instructions">
                  {runActive
                    ? 'Orbit is working · Send this draft when it finishes'
                    : 'Enter to send · Shift+Enter for a new line'}
                </span>
                {runActive ? (
                  <button
                    aria-label={runPresentation.phase === GuiRunPhase.Stopping ? 'Stopping response' : 'Stop response'}
                    className="send stop"
                    disabled={runId === undefined || runPresentation.phase === GuiRunPhase.Stopping}
                    onClick={stop}
                    title={runId === undefined ? 'Stop is unavailable for this recovered run' : 'Stop response'}
                  >
                    ■
                  </button>
                ) : (
                  <button
                    aria-label="Send message"
                    className="send"
                    disabled={
                      thread === undefined ||
                      prompt.trim().length === 0 ||
                      (projectsEnabled && membershipThread !== thread.id)
                    }
                    onClick={() => submit().catch(showError(setError))}
                    title="Send message"
                  >
                    <Icon name="send" />
                  </button>
                )}
              </div>
            </div>
            <p className="composer-status muted">
              {runActive ? runStatus : selectedSession ? 'Ready · Conversation saved locally' : 'Ready'}
            </p>
          </div>
        </section>

        {detailsOpen ? (
          <>
            <button aria-label="Close logs overlay" className="details-backdrop" onClick={closeDetails} />
            <aside
              aria-label="Conversation logs and details"
              className="diagnostics"
              id="conversation-details"
              ref={detailsPanel}
              tabIndex={-1}
            >
              <h2>Logs</h2>
              <section aria-labelledby="details-conversation">
                <h3 id="details-conversation">Conversation</h3>
                <p>
                  {membershipThread === thread?.id && membership?.projectId
                    ? (projects.find((project) => project.id === membership.projectId)?.name ?? 'Project')
                    : 'Unassigned'}{' '}
                  · {thread ? sessionTitle(thread, sessions) : 'New chat'}
                </p>
                <p>
                  Model · {thread?.provider ?? runtime?.provider ?? '…'} / {thread?.model ?? runtime?.model ?? '…'}
                </p>
                {selectedSession && (
                  <details>
                    <summary>Session information</summary>
                    <dl>
                      <SessionDetail label="Name" value={sessionDisplayName(selectedSession)} />
                      <SessionDetail label="Status" value={selectedSession.status} />
                      <SessionDetail label="Working directory" value={selectedSession.cwd} />
                      <SessionDetail label="Session ID" value={selectedSession.id} />
                    </dl>
                    <button className="outlined" onClick={() => copyId(selectedSession).catch(showError(setError))}>
                      Copy ID
                    </button>
                  </details>
                )}
                <div className="home-details">
                  <p className="muted">
                    Context: {runtime?.contextMode ?? 'disabled'} {thread ? contextNotices[thread.id] : ''}
                  </p>
                  {thread && membershipThread === thread.id && membership?.projectId && (
                    <ProjectMemoryPanel
                      api={api}
                      disabled={runActive}
                      key={`${thread.id}/${membership.projectId}`}
                      messages={thread.messages}
                      onChange={(selection) => setMemorySelections((current) => ({...current, [thread.id]: selection}))}
                      onError={showError(setError)}
                      onSource={async (sessionId) => {
                        const resumed = await api<ThreadSnapshot>(
                          `/api/projects/${membership.projectId}/sessions/${sessionId}/resume`,
                          {method: 'POST'},
                        )
                        selectedThreadId.current = resumed.id
                        setThread(resumed)
                      }}
                      projectId={membership.projectId}
                      selection={memorySelections[thread.id] ?? {mode: 'automatic'}}
                      threadId={thread.id}
                    />
                  )}
                </div>
                {thread?.run?.projectContext && (
                  <div role="status">
                    Recorded memory: {thread.run.projectContext.entryIds.length} notes ·{' '}
                    {thread.run.projectContext.tokens} tokens · {thread.run.projectContext.digest.slice(0, 12)}
                  </div>
                )}
              </section>
              <section aria-labelledby="details-run-settings">
                <h3 id="details-run-settings">Run settings</h3>
                <p>For the next run</p>
                {runActive && <p className="muted">The current run keeps its recorded limits and Skills.</p>}
                <div className="advanced-controls">
                  {thread && (
                    <BudgetPanel
                      active={runActive}
                      expanded
                      limits={nextLimits}
                      onChange={(key, value) =>
                        setLimitOverrides((current) => ({
                          ...current,
                          [thread.id]: {...current[thread.id], [key]: value},
                        }))
                      }
                      onContinue={() => submit(thread.run?.runId).catch(showError(setError))}
                      snapshot={thread.run}
                    />
                  )}

                  <details>
                    <summary>Skills · pending {(pendingSkills[thread?.id ?? ''] ?? []).length}</summary>
                    <button
                      disabled={runActive}
                      onClick={() => api<SkillListing>('/api/skills').then(setSkillList).catch(showError(setError))}
                    >
                      Refresh Skill catalog
                    </button>
                    <button
                      disabled={runActive || !thread}
                      onClick={() => thread && setPendingSkills((current) => ({...current, [thread.id]: []}))}
                    >
                      Clear pending Skills
                    </button>
                    {skillList.candidates.map((candidate) => (
                      <label key={candidate.id} style={{display: 'block'}}>
                        <input
                          checked={(pendingSkills[thread?.id ?? ''] ?? []).some(
                            (s) => s.id === candidate.id && s.digest === candidate.digest,
                          )}
                          disabled={runActive || !thread}
                          onChange={(event) => {
                            if (!thread) return
                            const {checked} = event.target
                            setPendingSkills((current) => ({
                              ...current,
                              [thread.id]: checked
                                ? [
                                    ...(current[thread.id] ?? []).filter((s) => s.id !== candidate.id),
                                    {digest: candidate.digest, id: candidate.id},
                                  ]
                                : (current[thread.id] ?? []).filter((s) => s.id !== candidate.id),
                            }))
                          }}
                          type="checkbox"
                        />
                        {candidate.name} — {candidate.file} — {candidate.description}
                        {candidate.plugin && <span> · Plugin: {candidate.plugin.id}</span>}
                        {candidate.allowedTools !== undefined && (
                          <span> · Suggested tools (no permission grant): {candidate.allowedTools}</span>
                        )}
                        {candidate.license !== undefined && <span> · License: {candidate.license}</span>}
                        {candidate.compatibility !== undefined && (
                          <span> · Compatibility: {candidate.compatibility}</span>
                        )}
                      </label>
                    ))}
                    {skillList.issues.map((issue, index) => (
                      <div key={index}>{issue}</div>
                    ))}
                    {thread?.run?.skills && (
                      <p>
                        {thread.run.result ? 'Finished' : thread.run.skills.resolved ? 'Resolved' : 'Loading'} Skills:{' '}
                        {thread.run.skills.requested.map((s) => s.id).join(', ')}
                      </p>
                    )}
                    <button
                      disabled={!thread}
                      onClick={() =>
                        thread &&
                        api(`/api/sessions/${encodeURIComponent(thread.id)}/skills`)
                          .then((value) => setSkillHistory(JSON.stringify(value, null, 2)))
                          .catch(showError(setError))
                      }
                    >
                      Inspect saved Skill sources
                    </button>
                    {skillHistory && <pre>{skillHistory}</pre>}
                  </details>
                </div>
                {thread?.run && (
                  <details>
                    <summary>{thread.run.result ? 'Last run' : 'Current run'} · recorded settings</summary>
                    <pre>
                      {JSON.stringify({limits: thread.run.limits, skills: thread.run.skills?.requested ?? []}, null, 2)}
                    </pre>
                  </details>
                )}
              </section>
              <section aria-labelledby="details-logs">
                <h3 id="details-logs">Logs</h3>
                {preferences.debugPanelVisible ? (
                  <>
                    <header className="topbar">
                      <div className="filters">
                        <select
                          aria-label="Log level"
                          onChange={(event) => setEventFilter(event.target.value)}
                          value={eventFilter}
                        >
                          <option value="all">All levels</option>
                          <option value="info">Info</option>
                          <option value="debug">Debug</option>
                          <option value="warn">Warn</option>
                          <option value="error">Error</option>
                        </select>
                        <select
                          aria-label="Log category"
                          onChange={(event) => setCategoryFilter(event.target.value)}
                          value={categoryFilter}
                        >
                          <option value="all">All categories</option>
                          <option value="lifecycle">Lifecycle</option>
                          <option value="model">Model</option>
                          <option value="tool">Tool</option>
                          <option value="mcp">MCP</option>
                          <option value="storage">Storage</option>
                          <option value="runtime">Runtime</option>
                          <option value="security">Security</option>
                        </select>
                        <select
                          aria-label="Global diagnostic capture"
                          onChange={(event) =>
                            updatePreferences({diagnosticCapture: event.target.value as DiagnosticCapture})
                          }
                          value={preferences.diagnosticCapture}
                        >
                          <option value="full">Global: Full (15 min)</option>
                          <option value="metadata">Global: Metadata</option>
                          <option value="off">Global: Off</option>
                        </select>
                      </div>
                    </header>
                    <div className="events">
                      {thread === undefined ? <div className="empty">Select a session to view its logs.</div> : null}
                      {thread !== undefined && visibleLogs.length === 0 ? (
                        <div className="empty">No logs for this session.</div>
                      ) : null}
                      {visibleLogs.map((record) => (
                        <details className={`event ${record.level}`} key={record.id}>
                          <summary>
                            <span className="event-time">{formatTime(record.timestamp)}</span>
                            <span className="event-type">{record.eventType}</span>
                            <span className="event-level">{record.level}</span>
                          </summary>
                          <pre>{JSON.stringify(record, null, 2)}</pre>
                        </details>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">Diagnostic display is disabled in Settings.</p>
                )}
              </section>
              <button className="outlined close-details" onClick={closeDetails}>
                Close logs
              </button>
            </aside>
          </>
        ) : null}
      </div>
      <ApprovalDialog
        approval={page === 'home' ? thread?.run?.approvals.find((item) => !dismissedApproval.has(item.id)) : undefined}
        busy={approvalBusy}
        error={error}
        now={clock}
        onClose={(id) => setDismissedApproval((current) => new Set([id, ...current]))}
        onReply={replyApproval}
        returnFocus={() => document.querySelector<HTMLButtonElement>('.important-status button')?.focus()}
      />
      <SessionDetailsDialog
        onClose={closeSessionDetails}
        onCopy={(session) => copyId(session).catch(showError(setError))}
        session={sessionToInspect}
      />
      <DeleteSessionDialog
        onCancel={() => setSessionToDelete(undefined)}
        onConfirm={(session) => deleteSession(session).catch(() => {})}
        session={sessionToDelete}
      />
      {notice === undefined ? null : (
        <div aria-live="polite" className="toast" role="status">
          {notice}
        </div>
      )}
    </main>
  )
}

function SessionDetailsDialog({
  onClose,
  onCopy,
  session,
}: {
  onClose: () => void
  onCopy: (session: SessionSummary) => void
  session?: SessionSummary
}) {
  const copyButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (session === undefined) return
    copyButton.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose, session])
  if (session === undefined) return null
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-describedby="session-details-privacy"
        aria-labelledby="session-details-title"
        aria-modal="true"
        className="dialog session-details"
        role="dialog"
      >
        <h2 id="session-details-title">Session details</h2>
        <p id="session-details-privacy">
          Local paths can reveal private workspace information. Review these details before sharing them.
        </p>
        <div className="session-id-row">
          <code>{session.id}</code>
          <button onClick={() => onCopy(session)} ref={copyButton}>
            Copy ID
          </button>
        </div>
        <dl>
          <SessionDetail label="Name" value={sessionDisplayName(session)} />
          <SessionDetail label="Status" value={session.status} />
          <SessionDetail label="Created" value={formatFullDate(session.createdAt)} />
          <SessionDetail label="Updated" value={formatFullDate(session.updatedAt)} />
          <SessionDetail label="Working directory" value={session.cwd} />
          <SessionDetail label="Originator" value={session.originator ?? 'Not recorded'} />
          <SessionDetail label="Provider" value={session.provider ?? 'Not recorded'} />
          <SessionDetail label="Model" value={session.model ?? 'Not recorded'} />
          <SessionDetail label="Transcript file" value={session.file} />
        </dl>
        <div className="dialog-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  )
}

function SessionDetail({label, value}: {label: string; value: string}) {
  return (
    <div className="session-detail">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function DeleteSessionDialog({
  onCancel,
  onConfirm,
  session,
}: {
  onCancel: () => void
  onConfirm: (session: SessionSummary) => void
  session?: SessionSummary
}) {
  if (session === undefined) return null
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="delete-session-title" aria-modal="true" className="dialog" role="dialog">
        <h2 id="delete-session-title">Delete session?</h2>
        <p>
          This deletes the transcript, diagnostic logs and execution journal/key. A minimal deletion marker remains to
          prevent reuse of the session ID. Active or unconfirmed runs must be resolved first.
        </p>
        <div className="dialog-session">{sessionDisplayName(session)}</div>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button autoFocus className="danger" onClick={() => onConfirm(session)}>
            Delete
          </button>
        </div>
      </section>
    </div>
  )
}

function MessageView({message}: {message: ThreadMessage}) {
  const payload = isRecord(message.payload) ? message.payload : undefined
  const toolCalls = Array.isArray(payload?.toolCalls) ? payload.toolCalls : []
  const label = message.type === 'tool' ? 'Tool result' : message.role === 'user' ? 'You' : 'Orbit'
  return (
    <article className={`message ${message.role}`}>
      <div className="message-label">{label}</div>
      {message.content.length === 0 ? null : <div className="message-body">{message.content}</div>}
      {toolCalls.map((call, index) => (
        <details className="tool-card" key={isRecord(call) && typeof call.id === 'string' ? call.id : index}>
          <summary>Tool request · {isRecord(call) && typeof call.name === 'string' ? call.name : 'unknown'}</summary>
          <pre>{JSON.stringify(call, null, 2)}</pre>
        </details>
      ))}
      {message.type === 'tool' && payload !== undefined ? (
        <details className="tool-card">
          <summary>Tool result details</summary>
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </details>
      ) : null}
      {isRecord(payload?.response) ? (
        <details className="tool-card">
          <summary>Model response metadata</summary>
          <pre>{JSON.stringify(payload.response, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  )
}

async function api<T = unknown>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(pathname, {
    ...init,
    headers: {'X-Orbit-Token': token, ...init.headers},
  })
  const body = (await response.json()) as T | {error?: string}
  if (!response.ok)
    throw new Error(
      isRecord(body) && typeof body.error === 'string' ? body.error : `Request failed: ${response.status}`,
    )
  return body as T
}

function sessionTitle(thread: ThreadSnapshot, sessions: SessionSummary[]): string {
  const saved = sessions.find((session) => session.id === thread.id)
  const titleSource = (saved?.titleRevision ?? -1) >= (thread.titleRevision ?? -1) ? saved : thread
  return sessionDisplayName({
    preview: saved?.preview ?? thread.messages.find((message) => message.type === 'user')?.contents[0],
    provider: saved?.provider ?? thread.provider,
    title: titleSource?.title,
  })
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function formatFullDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'medium'}).format(new Date(timestamp))
}

function appendUniqueLog(records: LogRecord[], record: LogRecord): LogRecord[] {
  if (records.some((existing) => existing.id === record.id)) return records
  return [...records.slice(-999), record]
}

function mergeLogs(backfill: LogRecord[], live: LogRecord[]): LogRecord[] {
  let records = backfill
  for (const record of live) records = appendUniqueLog(records, record)
  return records
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function showError(setError: (message: string) => void) {
  return (error: unknown) => setError(error instanceof Error ? error.message : String(error))
}

createRoot(document.querySelector('#root') as HTMLElement).render(<App />)
