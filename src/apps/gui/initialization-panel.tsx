// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {useEffect, useRef, useState} from 'react'

import type {InitializationMode, InitializationPlan} from '../../core/maintenance/initialization.js'
import type {SidebarApi} from './sidebar-model.js'

export function InitializationPanel({api}: {api: SidebarApi}) {
  const [mode, setMode] = useState<InitializationMode>('settings')
  const [selected, setSelected] = useState<string[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [plan, setPlan] = useState<InitializationPlan>()
  const [stopped, setStopped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [word, setWord] = useState('')
  const reviewing = stopped && !done
  const inputsDisabled = busy || stopped || done
  const lock = useRef(false)
  useEffect(() => {
    api<{settingsFiles: string[]}>('/api/initialization')
      .then((value) => setSources(value.settingsFiles))
      .catch((error_: unknown) => setError(String(error_)))
  }, [api])
  const act = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (error_) {
      setError(String(error_))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const request = (stage: string) =>
    act(async () => {
      if (stage === 'prepare') {
        setStopped(true)
        setPlan(undefined)
      }

      const value = await api<InitializationPlan>('/api/initialization/' + stage, {
        body: JSON.stringify({mode, settingsFiles: mode === 'data' ? [] : selected}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      setPlan(value)
      setStopped(stage === 'prepare')
      setConfirmed(false)
      setWord('')
    })
  return (
    <section aria-label="Initialization" className="initialization-panel">
      <h2>Initialization</h2>
      <p>
        Permanently remove selected data, not move it to Trash. No backup is created. CLI and this GUI share Orbit
        storage.
      </p>
      <label>
        Scope{' '}
        <select
          aria-label="Initialization scope"
          disabled={inputsDisabled}
          onChange={(e) => {
            setMode(e.target.value as InitializationMode)
            setPlan(undefined)
          }}
          value={mode}
        >
          <option value="settings">Reset settings</option>
          <option value="data">Reset conversations, projects and schedules</option>
          <option value="all">Reset all app settings, saved data and owned cache</option>
        </select>
      </label>
      {mode !== 'data' && (
        <fieldset disabled={inputsDisabled}>
          <legend>Settings files (explicit selection)</legend>
          <p>
            These files may be inherited by other projects and contain credentials. Unselected files are retained. GUI
            display preferences reset on restart.
          </p>
          {sources.map((file) => (
            <label key={file}>
              <input
                checked={selected.includes(file)}
                onChange={(e) => {
                  setSelected(e.target.checked ? [...selected, file] : selected.filter((p) => p !== file))
                  setPlan(undefined)
                }}
                type="checkbox"
              />
              {file}
            </label>
          ))}
        </fieldset>
      )}
      <p>
        User workspaces, skills, context files, environment credentials, Docker and Ollama are retained. No browser
        cache is owned by the embedded GUI.
      </p>
      {error && <p role="alert">{error}</p>}
      {!done && (
        <div className="dialog-actions">
          <button disabled={busy || stopped} onClick={() => request('plan')}>
            Preview without changes
          </button>
          <button disabled={busy || stopped} onClick={() => request('prepare')}>
            Stop this host and review
          </button>
        </div>
      )}
      {plan && (
        <>
          <h3>Targets: {plan.disposition} deletion</h3>
          <ul>
            {plan.targets.map((target) => (
              <li key={target.path}>
                {target.path} · {target.files} files · {target.bytes} bytes
              </li>
            ))}
          </ul>
          <p>
            {plan.targets.length === 0
              ? 'No persistent targets selected; restart resets GUI display preferences.'
              : 'Only the displayed targets are removed.'}
          </p>
          <h3>Retained</h3>
          <ul>
            {plan.retained.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {reviewing && plan && (
        <fieldset disabled={busy}>
          <legend>Final confirmation</legend>
          <p>
            This host is stopped. Cancel by closing it; restart is required. Idle external CLI/GUI processes cannot all
            be detected.
          </p>
          <label>
            <input checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} type="checkbox" />I stopped all
            other current and older writers, disabled automatic restarters and hold exclusive control, including shared
            settings.
          </label>
          <label>
            Type INITIALIZE{' '}
            <input aria-label="Initialization confirmation" onChange={(e) => setWord(e.target.value)} value={word} />
          </label>
          <button
            disabled={busy || !confirmed || word !== 'INITIALIZE'}
            onClick={() =>
              act(async () => {
                await api('/api/initialization/execute', {
                  body: JSON.stringify({
                    allWritersStopped: confirmed,
                    automaticRestartersDisabled: confirmed,
                    confirmation: word,
                    exclusiveStorageControl: confirmed,
                    id: plan?.id,
                  }),
                  headers: {'Content-Type': 'application/json'},
                  method: 'POST',
                })
                setDone(true)
              })
            }
          >
            Permanently initialize
          </button>
        </fieldset>
      )}
      {reviewing && <p role="status">This host is in maintenance. Close it to cancel; normal work requires restart.</p>}
      {reviewing && error && (
        <button disabled={busy} onClick={() => request('prepare')}>
          Review remaining targets
        </button>
      )}
      {done && (
        <p role="status">
          Initialization completed. Close this host and restart Orbit. Missing storage requires initialization; no work
          is replayed.
        </p>
      )}
    </section>
  )
}
