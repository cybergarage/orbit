// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-unsupported-features/node-builtins */
/* global document, EventSource, fetch, HTMLButtonElement, HTMLDivElement, HTMLElement, HTMLMetaElement, KeyboardEvent, MessageEvent, navigator, RequestInit, window */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'

import type {
  DiagnosticCapture,
  DiagnosticEvent,
  GuiPreferences,
  LogPage,
  LogRecord,
  RuntimeSnapshot,
  SessionListResult,
  SessionSummary,
  SkillListing,
  SkillSelection,
  StartApplicationRunResult,
  ThreadMessage,
  ThreadSnapshot,
} from '../../core/index.js'

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

const token = document.querySelector<HTMLMetaElement>('meta[name="orbit-token"]')?.content ?? ''

// Session selection coordinates conversation, backfill, live logs, and deletion in one renderer boundary.
// eslint-disable-next-line complexity
function App() {
  const [runtime, setRuntime] = useState<RuntimeSnapshot>()
  const [contextNotices, setContextNotices] = useState<Record<string, string>>({})
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [thread, setThread] = useState<ThreadSnapshot>()
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

  const loadSessions = useCallback(async () => {
    const result = await api<SessionListResult>('/api/sessions?limit=100')
    setSessions(result.data)
  }, [])

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
      if (event.type === 'run.completed' || event.type === 'session.created' || event.type === 'session.resumed') {
        loadSessions().catch(() => {})
      }
    })
    source.addEventListener('log', (message) => {
      const record = JSON.parse((message as MessageEvent).data) as LogRecord
      if (record.correlation.sessionId !== selectedThreadId.current) return
      setLogs((current) => appendUniqueLog(current, record))
    })
    source.addEventListener('open', () => {
      setError((current) => (current === 'The event stream disconnected. Reconnecting…' ? undefined : current))
      if (selectedThreadId.current) refreshThread(selectedThreadId.current).catch(() => {})
    })
    source.addEventListener('error', () => setError('The event stream disconnected. Reconnecting…'))
    return () => source.close()
  }, [loadSessions, refreshThread])

  useEffect(() => {
    selectedThreadId.current = thread?.id
    setLogs([])
    if (thread === undefined) return
    const threadId = thread.id
    api<LogPage>(`/api/sessions/${encodeURIComponent(threadId)}/logs?limit=200`)
      .then((page) => {
        if (selectedThreadId.current === threadId) {
          setLogs((current) => mergeLogs(page.data, current))
        }
      })
      .catch(showError(setError))
  }, [thread?.id])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({behavior: 'smooth'})
  }, [thread?.messages.length])

  useEffect(() => {
    if (notice === undefined) return
    const timeout = globalThis.setTimeout(() => setNotice(undefined), 2400)
    return () => globalThis.clearTimeout(timeout)
  }, [notice])

  const createThread = async () => {
    try {
      setError(undefined)
      const created = await api<ThreadSnapshot>('/api/threads', {method: 'POST'})
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

  const selectSession = async (session: SessionSummary) => {
    try {
      setError(undefined)
      selectedThreadId.current = session.id
      setLogs([])
      const resumed = await api<ThreadSnapshot>(`/api/sessions/${encodeURIComponent(session.id)}/resume`, {
        method: 'POST',
      })
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
    if (!thread?.run) return
    try {
      await api(`/api/runs/${encodeURIComponent(thread.run.runId)}/approvals`, {
        body: JSON.stringify({approve, digest, requestId}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      await refreshThread(thread.id)
    } catch (nextError) {
      showError(setError)(nextError)
    }
  }

  const retrySubmission = useRef<
    undefined | {content: string; requestId: string; selectionKey: string; threadId: string}
  >(undefined)
  const submit = async () => {
    if (thread === undefined || prompt.trim().length === 0) return
    const threadId = thread.id
    const presentation = runPresentations[threadId] ?? reconcileGuiRunWithThread(undefined, thread.status)
    if (isGuiRunActive(presentation) || pendingSubmissions.current.has(threadId)) return
    const content = prompt
    const skills = content.startsWith('/') ? [] : (pendingSkills[threadId] ?? [])
    const selectionKey = JSON.stringify(skills)
    pendingSubmissions.current.add(threadId)
    try {
      setError(undefined)
      setPrompt('')
      setRunPresentations((current) => ({...current, [threadId]: beginGuiRun()}))
      const result = await api<StartApplicationRunResult>(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
        body: JSON.stringify({
          content,
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
    try {
      const next = await api<GuiPreferences>('/api/preferences', {
        body: JSON.stringify(update),
        headers: {'Content-Type': 'application/json'},
        method: 'PATCH',
      })
      setPreferences(next)
    } catch (nextError) {
      showError(setError)(nextError)
    }
  }

  const openSessionDetails = (session: SessionSummary) => {
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.context-menu') === null) {
      sessionDetailsReturnFocus.current = document.activeElement
    }

    setSessionToInspect(session)
  }

  const copyId = async (session: SessionSummary) => {
    setSessionMenu(undefined)
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
      className={`app ${preferences.debugPanelVisible ? '' : 'debug-hidden'}`}
      onClick={() => setSessionMenu(undefined)}
    >
      <aside className="pane sidebar">
        <div className="brand">
          <span className="brand-mark">O</span>
          <span>ORBIT</span>
        </div>
        <button className="primary" onClick={createThread}>
          ＋ New Chat
        </button>
        <div className="section-title">Recent</div>
        <div className="sessions">
          {sessions.map((session) => (
            <button
              className={`session ${thread?.id === session.id ? 'active' : ''}`}
              key={session.id}
              onClick={() => selectSession(session)}
              onContextMenu={(event) => {
                event.preventDefault()
                sessionDetailsReturnFocus.current = event.currentTarget
                const bounds = event.currentTarget.getBoundingClientRect()
                const requestedX = event.clientX || bounds.right
                const requestedY = event.clientY || bounds.top
                setSessionMenu({
                  session,
                  x: Math.max(8, Math.min(requestedX, window.innerWidth - 204)),
                  y: Math.max(8, Math.min(requestedY, window.innerHeight - 150)),
                })
              }}
            >
              <span className="session-title">{session.preview || `${session.provider ?? 'Orbit'} session`}</span>
              <span className="session-meta">
                {formatDate(session.updatedAt)} · {session.model ?? 'default model'}
              </span>
              <span className="session-meta">{session.cwd}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <label className="toggle-row">
            <span>Logs</span>
            <input
              checked={preferences.debugPanelVisible}
              onChange={(event) => updatePreferences({debugPanelVisible: event.target.checked})}
              type="checkbox"
            />
          </label>
        </div>
      </aside>

      <section className="pane conversation">
        <header className="topbar">
          <div className="title">{thread === undefined ? 'New conversation' : sessionTitle(thread, sessions)}</div>
          <div className="topbar-actions">
            <span className="badge">
              {thread?.provider ?? runtime?.provider ?? '…'} · {thread?.model ?? runtime?.model ?? '…'} · Context:{' '}
              {runtime?.contextMode ?? 'disabled'} {thread ? contextNotices[thread.id] : ''}
            </span>
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
                    y: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 150)),
                  })
                }}
                title="Session actions"
              >
                ⋯
              </button>
            )}
          </div>
        </header>
        {error === undefined ? null : <div className="error-banner">{error}</div>}
        {thread?.run?.approvals.map((approval) => (
          <section aria-label="Operation confirmation" className="tool-card" key={approval.id}>
            <strong>Confirm one operation</strong>
            <pre>{JSON.stringify(approval.preview, null, 2)}</pre>
            <p>
              Expires {new Date(approval.expiresAt).toLocaleTimeString()}. This is not permission for the entire
              session.
            </p>
            <button onClick={() => replyApproval(approval.id, approval.digest, false)}>Deny</button>
            <button onClick={() => replyApproval(approval.id, approval.digest, true)}>Approve once</button>
          </section>
        ))}
        {thread?.run?.result ? (
          <div role="status">
            Run: {thread.run.result.outcome}. Recording: {thread.run.result.recording.status}.{' '}
            {thread.run.result.quiescence ? '' : 'Work may still be active; conflicting resources remain reserved.'}
          </div>
        ) : null}

        <div aria-busy={runActive} className="messages">
          {thread === undefined || (thread.messages.length === 0 && runStatus === undefined) ? (
            <div className="empty">
              <div>
                <strong>What should Orbit work on?</strong>
                <br />
                Start a new chat or open a recent session.
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
                    : 'Ask Orbit anything…'
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
                  disabled={thread === undefined || prompt.trim().length === 0}
                  onClick={submit}
                  title="Send message"
                >
                  ↑
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {preferences.debugPanelVisible ? (
        <aside className="diagnostics">
          <header className="topbar">
            <div className="title">Logs{thread === undefined ? '' : ` · ${thread.id.slice(0, 8)}`}</div>
            <div className="filters">
              <select onChange={(event) => setEventFilter(event.target.value)} value={eventFilter}>
                <option value="all">All levels</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
              <select onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
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
                onChange={(event) => updatePreferences({diagnosticCapture: event.target.value as DiagnosticCapture})}
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
        </aside>
      ) : null}
      <SessionContextMenu
        menu={sessionMenu}
        onClose={() => {
          setSessionMenu(undefined)
          globalThis.setTimeout(() => sessionDetailsReturnFocus.current?.focus(), 0)
        }}
        onCopy={(session) => copyId(session).catch(showError(setError))}
        onDelete={(session) => {
          setSessionMenu(undefined)
          setSessionToDelete(session)
        }}
        onDetails={(session) => {
          setSessionMenu(undefined)
          openSessionDetails(session)
        }}
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

function SessionContextMenu({
  menu,
  onClose,
  onCopy,
  onDelete,
  onDetails,
}: {
  menu?: {session: SessionSummary; x: number; y: number}
  onClose: () => void
  onCopy: (session: SessionSummary) => void
  onDelete: (session: SessionSummary) => void
  onDetails: (session: SessionSummary) => void
}) {
  if (menu === undefined) return null
  return (
    <div
      aria-label="Session actions"
      className="context-menu"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      role="menu"
      style={{left: menu.x, top: menu.y}}
    >
      <button autoFocus onClick={() => onCopy(menu.session)} role="menuitem">
        Copy session ID
      </button>
      <button onClick={() => onDetails(menu.session)} role="menuitem">
        Session details…
      </button>
      <div className="context-menu-separator" role="separator" />
      <button className="context-menu-danger" onClick={() => onDelete(menu.session)} role="menuitem">
        Delete session…
      </button>
    </div>
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
        <div className="dialog-session">{session.preview ?? session.id}</div>
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
  return sessions.find((session) => session.id === thread.id)?.preview ?? 'Orbit session'
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(timestamp))
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(
    new Date(timestamp),
  )
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
