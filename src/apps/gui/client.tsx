// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable n/no-unsupported-features/node-builtins */
/* global document, EventSource, fetch, HTMLDivElement, HTMLElement, HTMLMetaElement, MessageEvent, RequestInit */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'

import type {
  DiagnosticCapture,
  DiagnosticEvent,
  GuiPreferences,
  RuntimeSnapshot,
  SessionListResult,
  SessionSummary,
  StartApplicationRunResult,
  ThreadMessage,
  ThreadSnapshot,
} from '../../core/index.js'

const token = document.querySelector<HTMLMetaElement>('meta[name="orbit-token"]')?.content ?? ''

function App() {
  const [runtime, setRuntime] = useState<RuntimeSnapshot>()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [thread, setThread] = useState<ThreadSnapshot>()
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const [preferences, setPreferences] = useState<GuiPreferences>({debugPanelVisible: true, diagnosticCapture: 'full'})
  const [prompt, setPrompt] = useState('')
  const [runId, setRunId] = useState<string>()
  const [error, setError] = useState<string>()
  const [eventFilter, setEventFilter] = useState('all')
  const messagesEnd = useRef<HTMLDivElement>(null)
  const selectedThreadId = useRef<string | undefined>(undefined)

  const loadSessions = useCallback(async () => {
    const result = await api<SessionListResult>('/api/sessions?limit=100')
    setSessions(result.data)
  }, [])

  const refreshThread = useCallback(async (threadId: string) => {
    const next = await api<ThreadSnapshot>(`/api/threads/${encodeURIComponent(threadId)}`)
    setThread(next)
    if (next.status === 'idle') setRunId(undefined)
  }, [])

  useEffect(() => {
    Promise.all([
      api<RuntimeSnapshot>('/api/runtime').then(setRuntime),
      api<GuiPreferences>('/api/preferences').then(setPreferences),
      loadSessions(),
    ]).catch(showError(setError))

    const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
    source.addEventListener('diagnostic', (message) => {
      const event = JSON.parse((message as MessageEvent).data) as DiagnosticEvent
      setEvents((current) => [...current.slice(-999), event])
      if (event.threadId !== undefined && event.threadId === selectedThreadId.current) refreshThread(event.threadId).catch(() => {})
      if (event.type === 'run.completed' || event.type === 'session.created' || event.type === 'session.resumed') {
        loadSessions().catch(() => {})
      }
    })
    source.addEventListener('error', () => setError('The diagnostics stream disconnected. Reconnecting…'))
    return () => source.close()
  }, [loadSessions, refreshThread])

  useEffect(() => {
    selectedThreadId.current = thread?.id
  }, [thread?.id])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({behavior: 'smooth'})
  }, [thread?.messages.length])

  const createThread = async () => {
    try {
      setError(undefined)
      const created = await api<ThreadSnapshot>('/api/threads', {method: 'POST'})
      setThread(created)
      await loadSessions()
    } catch (nextError) {
      showError(setError)(nextError)
    }
  }

  const selectSession = async (session: SessionSummary) => {
    try {
      setError(undefined)
      const resumed = await api<ThreadSnapshot>(`/api/sessions/${encodeURIComponent(session.id)}/resume`, {method: 'POST'})
      setThread(resumed)
    } catch (nextError) {
      showError(setError)(nextError)
    }
  }

  const submit = async () => {
    if (thread === undefined || prompt.trim().length === 0 || runId !== undefined) return
    try {
      setError(undefined)
      const result = await api<StartApplicationRunResult>(`/api/threads/${encodeURIComponent(thread.id)}/messages`, {
        body: JSON.stringify({content: prompt}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      setPrompt('')
      setRunId(result.runId)
      await refreshThread(result.threadId)
    } catch (nextError) {
      showError(setError)(nextError)
    }
  }

  const stop = async () => {
    if (runId === undefined) return
    await api(`/api/runs/${encodeURIComponent(runId)}/cancel`, {method: 'POST'}).catch(showError(setError))
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

  const visibleEvents = useMemo(
    () => events.filter((event) => eventFilter === 'all' || event.level === eventFilter),
    [eventFilter, events],
  )

  return (
    <main className={`app ${preferences.debugPanelVisible ? '' : 'debug-hidden'}`}>
      <aside className="pane sidebar">
        <div className="brand"><span className="brand-mark">O</span><span>ORBIT</span></div>
        <button className="primary" onClick={createThread}>＋ New Chat</button>
        <div className="section-title">Recent</div>
        <div className="sessions">
          {sessions.map((session) => (
            <button className={`session ${thread?.id === session.id ? 'active' : ''}`} key={session.id} onClick={() => selectSession(session)}>
              <span className="session-title">{session.preview || `${session.provider ?? 'Orbit'} session`}</span>
              <span className="session-meta">{formatDate(session.updatedAt)} · {session.model ?? 'default model'}</span>
              <span className="session-meta">{session.cwd}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <label className="toggle-row">
            <span>Diagnostics</span>
            <input checked={preferences.debugPanelVisible} onChange={(event) => updatePreferences({debugPanelVisible: event.target.checked})} type="checkbox"/>
          </label>
        </div>
      </aside>

      <section className="pane conversation">
        <header className="topbar">
          <div className="title">{thread === undefined ? 'New conversation' : sessionTitle(thread, sessions)}</div>
          <span className="badge">{thread?.provider ?? runtime?.provider ?? '…'} · {thread?.model ?? runtime?.model ?? '…'}</span>
        </header>
        {error === undefined ? null : <div className="error-banner">{error}</div>}
        <div className="messages">
          {thread === undefined || thread.messages.length === 0 ? (
            <div className="empty"><div><strong>What should Orbit work on?</strong><br/>Start a new chat or open a recent session.</div></div>
          ) : thread.messages.map((message) => <MessageView key={message.id} message={message}/>) }
          <div ref={messagesEnd}/>
        </div>
        <div className="composer-wrap">
          <div className="composer">
            <textarea
              disabled={thread === undefined}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit().catch(() => {})
                }
              }}
              placeholder={thread === undefined ? 'Create or select a chat first' : 'Ask Orbit anything…'}
              value={prompt}
            />
            <div className="composer-actions">
              <span>Enter to send · Shift+Enter for a new line</span>
              {runId === undefined ? (
                <button className="send" disabled={thread === undefined || prompt.trim().length === 0} onClick={submit}>↑</button>
              ) : <button className="send stop" onClick={stop}>■</button>}
            </div>
          </div>
        </div>
      </section>

      {preferences.debugPanelVisible ? (
        <aside className="diagnostics">
          <header className="topbar">
            <div className="title">Diagnostics</div>
            <div className="filters">
              <select onChange={(event) => setEventFilter(event.target.value)} value={eventFilter}>
                <option value="all">All levels</option><option value="info">Info</option><option value="debug">Debug</option><option value="warn">Warn</option><option value="error">Error</option>
              </select>
              <select onChange={(event) => updatePreferences({diagnosticCapture: event.target.value as DiagnosticCapture})} value={preferences.diagnosticCapture}>
                <option value="full">Full</option><option value="metadata">Metadata</option><option value="off">Off</option>
              </select>
            </div>
          </header>
          <div className="events">
            {visibleEvents.map((event) => (
              <details className={`event ${event.level}`} key={event.sequence}>
                <summary><span className="event-time">{formatTime(event.timestamp)}</span><span className="event-type">{event.type}</span><span className="event-level">{event.level}</span></summary>
                <pre>{JSON.stringify(event, null, 2)}</pre>
              </details>
            ))}
          </div>
        </aside>
      ) : null}
    </main>
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
      {message.type === 'tool' && payload !== undefined ? <details className="tool-card"><summary>Tool result details</summary><pre>{JSON.stringify(payload, null, 2)}</pre></details> : null}
      {isRecord(payload?.response) ? <details className="tool-card"><summary>Model response metadata</summary><pre>{JSON.stringify(payload.response, null, 2)}</pre></details> : null}
    </article>
  )
}

async function api<T = unknown>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(pathname, {
    ...init,
    headers: {'X-Orbit-Token': token, ...init.headers},
  })
  const body = (await response.json()) as T | {error?: string}
  if (!response.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `Request failed: ${response.status}`)
  return body as T
}

function sessionTitle(thread: ThreadSnapshot, sessions: SessionSummary[]): string {
  return sessions.find((session) => session.id === thread.id)?.preview ?? 'Orbit session'
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {day: '2-digit', hour: '2-digit', minute: '2-digit', month: 'short'}).format(new Date(timestamp))
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(timestamp))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function showError(setError: (message: string) => void) {
  return (error: unknown) => setError(error instanceof Error ? error.message : String(error))
}

createRoot(document.querySelector('#root') as HTMLElement).render(<App/>)
