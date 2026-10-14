// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* global RequestInit */
/* eslint-disable n/no-unsupported-features/node-builtins */

import {useCallback, useEffect, useRef, useState} from 'react'

import type {GuiPreferences, RuntimeSnapshot} from '../../core/application.js'
import type {DiagnosticCapture} from '../../core/diagnostics/index.js'
import type {WorkState} from '../../core/execution/scheduled-work.js'
import type {LocalTask} from './local-scheduler.js'

import {Icon} from './icons.js'
import {LatestRequest} from './latest-request.js'
import orbitLogo from './public/assets/orbit-logo-navy-blue.png'
import {SidebarDialog} from './sidebar.js'

type Api = <T>(url: string, init?: RequestInit) => Promise<T>
type ScheduleState = Omit<WorkState, 'data' | 'version'> & {cancelling?: string; enabled?: boolean; error?: string}
export function Brand() {
  return (
    <div className="brand">
      <img alt="Orbit" height="40" src={orbitLogo} width="120" />
    </div>
  )
}

// Scheduled view coordinates task selection, creation, history, and confirmation states.
// eslint-disable-next-line complexity
export function ScheduledWorkspace({api, closeDrawer}: {api: Api; closeDrawer: () => void}) {
  const [state, setState] = useState<ScheduleState>()
  const [selected, setSelected] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  const [pollError, setPollError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [confirmCancel, setConfirmCancel] = useState<string>()
  const [reconcile, setReconcile] = useState<string>()
  const [evidence, setEvidence] = useState('')
  const [stopped, setStopped] = useState(false)
  const requests = useRef(new LatestRequest())
  const refresh = useCallback(
    () =>
      requests.current.read(
        () => api<ScheduleState>('/api/schedules'),
        (value) => {
          setState(value)
          setPollError(undefined)
        },
      ),
    [api],
  )
  useEffect(() => {
    refresh().catch((error_: Error) => setPollError(error_.message))
    const timer = globalThis.setInterval(() => refresh().catch((error_: Error) => setPollError(error_.message)), 2000)
    return () => {
      requests.current.invalidate()
      globalThis.clearInterval(timer)
    }
  }, [refresh])
  const act = async (action: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(undefined)
    try {
      await action()
      await refresh()
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  const schedule = state?.schedules.find((item) => item.id === selected)
  const oneShotCreated =
    schedule && !schedule.interval && state?.occurrences.some((value) => value.scheduleId === schedule.id)
  const task = schedule?.payload as LocalTask | undefined
  const runs = [
    ...(state?.runs.filter(
      (run) =>
        !selected ||
        state.occurrences.some((occurrence) => occurrence.runId === run.id && occurrence.scheduleId === selected),
    ) ?? []),
  ].reverse()
  const newTask = () => {
    setCreating(true)
    closeDrawer()
  }

  return (
    <>
      <aside className="pane sidebar context-list">
        <Brand />
        <button className="nav-row" onClick={newTask}>
          <Icon name="plus" />
          New task
        </button>
        <div className="sidebar-heading">SCHEDULED</div>
        <div className="schedule-list">
          {state?.schedules.map((item) => {
            const value = item.payload as LocalTask
            return (
              <button
                className={`schedule-item ${selected === item.id ? 'active' : ''}`}
                key={item.id}
                onClick={() => {
                  setSelected(item.id)
                  setCreating(false)
                  closeDrawer()
                }}
              >
                <span>{value.name}</span>
                <small>{item.interval ? `Every ${item.interval / 60_000} minutes` : 'One time'}</small>
                <small>{item.paused ? 'Paused' : `Next · ${utc(item.next)}`}</small>
              </button>
            )
          })}
        </div>
      </aside>
      <section className="pane workspace">
        <header className="topbar">
          <div className="title">{creating ? 'New task' : (task?.name ?? 'Scheduled')}</div>
          <button className="nav-row" onClick={creating ? () => setCreating(false) : newTask}>
            <Icon name={creating ? 'schedule' : 'plus'} />
            {creating ? 'All tasks' : 'New task'}
          </button>
        </header>
        <div className="workspace-content">
          {(error || pollError || state?.error) && (
            <p className="error-banner" role="alert">
              {error || pollError || state?.error}
            </p>
          )}
          {creating ? (
            <TaskForm
              busy={busy}
              onCancel={() => setCreating(false)}
              onCreate={(value) =>
                act(async () => {
                  const result = await api<{id: string}>('/api/schedules', {
                    body: JSON.stringify(value),
                    headers: {'Content-Type': 'application/json'},
                    method: 'POST',
                  })
                  setSelected(result.id)
                  setCreating(false)
                })
              }
            />
          ) : (
            <>
              {schedule && task && (
                <article className="surface schedule-detail">
                  <h2>{task.name}</h2>
                  <p className="schedule-status">
                    {oneShotCreated ? 'One-time occurrence created' : schedule.paused ? 'Paused' : 'Active'} ·{' '}
                    {schedule.interval ? `every ${schedule.interval / 60_000} minutes` : 'one time'}
                    {!oneShotCreated && <> · next occurrence {utc(schedule.next)}</>}
                  </p>
                  <p className="muted">{task.workspace} · read-only</p>
                  <div className="inline-actions">
                    <button
                      disabled={busy || Boolean(oneShotCreated)}
                      onClick={() =>
                        act(async () => {
                          await api(`/api/schedules/${schedule.id}`, {
                            body: JSON.stringify({paused: !schedule.paused}),
                            headers: {'Content-Type': 'application/json'},
                            method: 'PATCH',
                          })
                        })
                      }
                      title={oneShotCreated ? 'Create a new task for another one-time occurrence' : undefined}
                    >
                      <Icon name="pause" />
                      {schedule.paused ? 'Resume schedule' : 'Pause schedule'}
                    </button>
                    <button onClick={() => setSelected(undefined)}>
                      <Icon name="schedule" />
                      All tasks
                    </button>
                  </div>
                  <p className="muted">Pausing stops future occurrences. Queued and running work is unaffected.</p>
                </article>
              )}
              <article className="surface">
                <h2>Run history</h2>
                {runs.length === 0 && (
                  <p className="muted">{state?.schedules.length ? 'No runs yet.' : 'No scheduled tasks.'}</p>
                )}
                {runs.map((run) => (
                  <div className="history-row" key={run.id}>
                    <div>
                      <p>
                        {utc(state?.occurrences.find((o) => o.runId === run.id)?.due ?? 0)} · {run.status}
                      </p>
                      <p className="muted">
                        Attempt {state?.attempts.filter((a) => a.runId === run.id).length} · {run.requestId}
                      </p>
                      {run.result && <pre>{run.result}</pre>}
                    </div>
                    {['approval', 'queued', 'running'].includes(run.status) && (
                      <button disabled={busy || state?.cancelling === run.id} onClick={() => setConfirmCancel(run.id)}>
                        <Icon name="cancel" />
                        {state?.cancelling === run.id ? 'Cancelling…' : 'Cancel run…'}
                      </button>
                    )}
                    {run.status === 'unknown' && (
                      <button
                        onClick={() => {
                          setReconcile(run.id)
                          setStopped(false)
                          setEvidence('')
                        }}
                      >
                        Reconcile…
                      </button>
                    )}
                  </div>
                ))}
              </article>
            </>
          )}
          <details className="scheduler-help">
            <summary>About local scheduling</summary>
            <p>
              {state?.enabled
                ? 'Local dispatch is enabled.'
                : 'Local dispatch is disabled. Start the GUI with --scheduled-work to enable it.'}{' '}
              Tasks run while this local GUI host is running. Missed intervals coalesce on restart. Only workspace reads
              are allowed; writes, commands and external sends are blocked. A run has a two-minute budget. Unknown
              outcomes require reconciliation and never replay automatically.
            </p>
          </details>
        </div>
      </section>
      {confirmCancel && (
        <SidebarDialog onClose={() => !locked.current && setConfirmCancel(undefined)} title="Cancel this run?">
          <p>Requests cooperative cancellation of this occurrence. Future occurrences keep their schedule.</p>
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setConfirmCancel(undefined)}>
              Keep running
            </button>
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api(`/api/scheduled-runs/${encodeURIComponent(confirmCancel)}/cancel`, {method: 'POST'})
                  setConfirmCancel(undefined)
                })
              }
            >
              Cancel run
            </button>
          </div>
        </SidebarDialog>
      )}
      {reconcile && (
        <SidebarDialog onClose={() => !locked.current && setReconcile(undefined)} title="Reconcile uncertain run">
          <p>Confirm external execution has stopped before closing this result as failed.</p>
          <textarea
            aria-label="Reconciliation evidence"
            maxLength={2000}
            onChange={(e) => setEvidence(e.target.value)}
            value={evidence}
          />
          <label>
            <input checked={stopped} onChange={(e) => setStopped(e.target.checked)} type="checkbox" />I verified
            execution has stopped
          </label>
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setReconcile(undefined)}>
              Back
            </button>
            <button
              disabled={busy || !stopped || !evidence.trim()}
              onClick={() =>
                act(async () => {
                  await api(`/api/scheduled-runs/${encodeURIComponent(reconcile)}/reconcile`, {
                    body: JSON.stringify({confirmedStopped: true, evidence}),
                    headers: {'Content-Type': 'application/json'},
                    method: 'POST',
                  })
                  setReconcile(undefined)
                })
              }
            >
              Close as failed
            </button>
          </div>
        </SidebarDialog>
      )}
    </>
  )
}

function TaskForm({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean
  onCancel: () => void
  onCreate: (value: unknown) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [instructions, setInstructions] = useState('')
  const [first, setFirst] = useState('')
  const [repeating, setRepeating] = useState(false)
  const [seconds, setSeconds] = useState('1800')
  const operationId = useRef(crypto.randomUUID())
  useEffect(() => {
    operationId.current = crypto.randomUUID()
  }, [name, workspace, instructions, first, repeating, seconds])
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        // The parent action catches failures and renders the error banner.
        // eslint-disable-next-line no-void
        void onCreate({
          next: Date.parse(`${first}Z`),
          task: {instructions, name, permissions: 'workspace-read', version: 1, workspace},
          ...(repeating ? {interval: Number(seconds) * 1000} : {}),
          operationId: operationId.current,
        })
      }}
    >
      <div className="task-columns">
        <article className="surface">
          <h2>Task</h2>
          <label>
            Name
            <input maxLength={120} onChange={(e) => setName(e.target.value)} required value={name} />
          </label>
          <label>
            Project / workspace
            <input
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="Absolute local directory"
              required
              value={workspace}
            />
          </label>
          <label>
            Instructions
            <textarea
              maxLength={16_000}
              onChange={(e) => setInstructions(e.target.value)}
              required
              value={instructions}
            />
          </label>
          <p>Permissions · read-only</p>
          <p className="muted">
            Allowed: read selected workspace files.
            <br />
            Blocked: file writes, shell commands and external sends.
          </p>
        </article>
        <article className="surface">
          <h2>When to run</h2>
          <div className="segmented">
            <button aria-pressed={!repeating} onClick={() => setRepeating(false)} type="button">
              <Icon name="once" />
              One time
            </button>
            <button aria-pressed={repeating} onClick={() => setRepeating(true)} type="button">
              <Icon name="schedule" />
              Fixed interval
            </button>
          </div>
          <label>
            First run · UTC
            <input onChange={(e) => setFirst(e.target.value)} required type="datetime-local" value={first} />
          </label>
          {repeating && (
            <label>
              Repeat every · seconds
              <input
                max="2147483"
                min="1"
                onChange={(e) => setSeconds(e.target.value)}
                required
                type="number"
                value={seconds}
              />
            </label>
          )}
          <p className="muted">Fixed duration, minimum 1 second. Not a calendar / daylight-saving schedule.</p>
          <p>Action permissions</p>
          <p className="muted">
            Actions beyond these permissions are not allowed. Tool approval is never granted automatically.
          </p>
        </article>
      </div>
      <div className="inline-actions form-actions">
        <button disabled={busy} onClick={onCancel} type="button">
          <Icon name="cancel" />
          Cancel
        </button>
        <button className="selected" disabled={busy} type="submit">
          <Icon name="check" />
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </div>
    </form>
  )
}

export function SettingsWorkspace({
  busy,
  closeDrawer,
  preferences,
  runtime,
  update,
}: {
  busy: boolean
  closeDrawer: () => void
  preferences: GuiPreferences
  runtime?: RuntimeSnapshot
  update: (value: Partial<GuiPreferences>) => void
}) {
  const [tab, setTab] = useState('diagnostics')
  return (
    <>
      <aside className="pane sidebar context-list">
        <Brand />
        {['diagnostics', 'runtime'].map((value) => (
          <button
            className={`nav-row ${tab === value ? 'active' : ''}`}
            key={value}
            onClick={() => {
              setTab(value)
              closeDrawer()
            }}
          >
            <Icon name={value === 'diagnostics' ? 'settings' : 'info'} />
            {value === 'diagnostics' ? 'Diagnostics' : 'Runtime information'}
          </button>
        ))}
      </aside>
      <section className="pane workspace settings-workspace">
        <header className="topbar">
          <div className="title">Settings</div>
        </header>
        <div className="workspace-content">
          {tab === 'diagnostics' ? (
            <>
              <h2>Diagnostics</h2>
              <div className="settings-toggle">
                <span>Show Logs panel</span>
                <button
                  aria-label="Show Logs panel"
                  aria-pressed={preferences.debugPanelVisible}
                  disabled={busy}
                  onClick={() => update({debugPanelVisible: !preferences.debugPanelVisible})}
                >
                  <Icon name="settings" />
                  {preferences.debugPanelVisible ? 'On' : 'Off'}
                </button>
              </div>
              <p>Diagnostic capture</p>
              <div className="segmented">
                {(['off', 'metadata', 'full'] as DiagnosticCapture[]).map((value) => (
                  <button
                    aria-pressed={preferences.diagnosticCapture === value}
                    disabled={busy}
                    key={value}
                    onClick={() => update({diagnosticCapture: value})}
                  >
                    <Icon name="settings" />
                    {value[0].toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
              <p className="muted">Full capture returns to Metadata after 15 minutes.</p>
            </>
          ) : (
            <>
              <h2>Runtime information</h2>
              <dl>
                {runtime &&
                  Object.entries({
                    Model: runtime.model,
                    Provider: runtime.provider,
                    'Session storage': runtime.sessionRoot,
                    Version: runtime.version,
                    Workspace: runtime.cwd,
                  }).map(([key, value]) => (
                    <div className="session-detail" key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
            </>
          )}
        </div>
      </section>
    </>
  )
}

function utc(value: number) {
  return new Date(value)
    .toISOString()
    .replace('T', ' ')
    .replace(/:\d{2}\.\d{3}Z$/u, ' UTC')
}
