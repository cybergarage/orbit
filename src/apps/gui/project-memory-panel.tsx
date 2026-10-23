// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* global RequestInit */
/* eslint-disable n/no-unsupported-features/node-builtins */
import {useEffect, useRef, useState} from 'react'

import type {
  ProjectContextSnapshot,
  ProjectMemoryEntry,
  ProjectMemorySelection,
  ThreadMessage,
} from '../../core/index.js'

interface Props {
  api: <T>(pathname: string, init?: RequestInit) => Promise<T>
  disabled: boolean
  messages: ThreadMessage[]
  onChange: (selection: ProjectMemorySelection) => void
  onError: (error: unknown) => void
  onSource: (sessionId: string) => Promise<void>
  projectId: string
  selection: ProjectMemorySelection
  threadId: string
}

export function ProjectMemoryPanel({
  api,
  disabled,
  messages,
  onChange,
  onError,
  onSource,
  projectId,
  selection,
  threadId,
}: Props) {
  const [inputLimit, setInputLimit] = useState(100_000)
  const [outputLimit, setOutputLimit] = useState(16_384)
  const [callLimit, setCallLimit] = useState(16)
  const [entries, setEntries] = useState<ProjectMemoryEntry[]>([])
  const [cursor, setCursor] = useState<string>()
  const [preview, setPreview] = useState<ProjectContextSnapshot>()
  const [history, setHistory] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [editing, setEditing] = useState<ProjectMemoryEntry>()
  const [busy, setBusy] = useState(false)
  const operations = useRef(new Map<string, string>())
  const base = `/api/projects/${encodeURIComponent(projectId)}/memory`
  const load = async (after?: string) => {
    const page = await api<{data: ProjectMemoryEntry[]; nextCursor?: string}>(
      `${base}?retired=all&limit=200${after ? `&after=${after}` : ''}`,
    )
    setEntries((current) => (after ? [...current, ...page.data] : page.data))
    setCursor(page.nextCursor)
  }

  useEffect(() => {
    load().catch(onError)
  }, [projectId])
  const change = (next: ProjectMemorySelection) => {
    setPreview(undefined)
    onChange(next)
  }

  const act = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }

  const write = async (entry?: ProjectMemoryEntry, retired = false) => {
    const payload = entry
      ? {body: entry.body, expectedRevision: entry.revision, retired, title: entry.title}
      : editing
        ? {body, expectedRevision: editing.revision, retired: editing.retired, title}
        : sourceId
          ? {body: body || excerpt, excerpt, messageId: sourceId, sessionId: threadId, title}
          : {body, title}
    const pathname = entry || editing ? `${base}/${(entry ?? editing)!.id}` : sourceId ? `${base}/excerpts` : base
    const key = JSON.stringify([pathname, payload])
    if (!operations.current.has(key)) operations.current.set(key, crypto.randomUUID())
    await api(pathname, {
      body: JSON.stringify({...payload, operationId: operations.current.get(key)}),
      headers: {'Content-Type': 'application/json'},
      method: entry || editing ? 'PATCH' : 'POST',
    })
    operations.current.delete(key)
    setEditing(undefined)
    setTitle('')
    setBody('')
    setExcerpt('')
    setSourceId('')
    change({mode: selection.mode, selectedIds: (selection.selectedIds ?? []).filter((id) => id !== entry?.id)})
    await load()
  }

  return (
    <details className="project-memory">
      <summary>Project memory</summary>
      <p>
        Automatically reuse relevant knowledge across conversations in this Project. Memory is historical data, never
        permission to act.
      </p>
      <fieldset disabled={disabled || busy}>
        <button
          onClick={() =>
            act(async () => {
              await api(`${base}/automatic`, {
                body: JSON.stringify({enabled: false}),
                headers: {'Content-Type': 'application/json'},
                method: 'POST',
              })
            })
          }
        >
          Stop automatic extraction
        </button>
        <button
          onClick={() =>
            act(async () => {
              await api(`${base}/automatic`, {
                body: JSON.stringify({enabled: true}),
                headers: {'Content-Type': 'application/json'},
                method: 'POST',
              })
            })
          }
        >
          Resume automatic extraction
        </button>
        <button
          onClick={() =>
            act(async () => {
              setHistory(JSON.stringify(await api(`${base}/automatic`), null, 2))
            })
          }
        >
          Processing status and budgets
        </button>
        <p>
          Local bounded extraction uses gemma4:12b without tools. Reservations remain charged after interruption;
          reported usage can be unknown.
        </p>
        <label>
          Lifetime input-token limit{' '}
          <input
            max={10_000_000}
            min={0}
            onChange={(event) => setInputLimit(Number(event.target.value))}
            type="number"
            value={inputLimit}
          />
        </label>
        <label>
          Lifetime output-token limit{' '}
          <input
            max={1_000_000}
            min={0}
            onChange={(event) => setOutputLimit(Number(event.target.value))}
            type="number"
            value={outputLimit}
          />
        </label>
        <label>
          Lifetime call limit{' '}
          <input
            max={10_000}
            min={0}
            onChange={(event) => setCallLimit(Number(event.target.value))}
            type="number"
            value={callLimit}
          />
        </label>
        <button
          onClick={() =>
            act(async () => {
              const prior = await api<{config: null | {enabled: boolean}}>(`${base}/automatic`)
              await api(`${base}/automatic`, {
                body: JSON.stringify({
                  enabled: prior.config?.enabled ?? true,
                  limits: {maxCalls: callLimit, maxInputTokens: inputLimit, maxOutputTokens: outputLimit},
                }),
                headers: {'Content-Type': 'application/json'},
                method: 'POST',
              })
            })
          }
        >
          Apply extraction limits
        </button>
        <label>
          Use for the next run{' '}
          <select
            aria-label="Project memory mode"
            onChange={(event) => change({mode: event.target.value as 'automatic' | 'curated' | 'off'})}
            value={selection.mode}
          >
            <option value="automatic">Automatic memory</option>
            <option value="curated">Curated memory</option>
            <option value="off">Off</option>
          </select>
        </label>
        <p>
          Selected notes take priority. Other eligible notes are added within the 16-note / 2,048-token limit. Off does
          not remove earlier quotations or snapshots.
        </p>
        <button
          onClick={() =>
            act(async () => {
              change({mode: selection.mode, selectedIds: selection.selectedIds})
              await load()
            })
          }
        >
          Refresh notes
        </button>
        {entries.map((entry) => (
          <article key={entry.id}>
            <label>
              <input
                checked={(selection.selectedIds ?? []).includes(entry.id)}
                disabled={entry.retired || selection.mode === 'off'}
                onChange={(event) =>
                  change({
                    mode: selection.mode,
                    selectedIds: event.target.checked
                      ? [...(selection.selectedIds ?? []), entry.id]
                      : selection.selectedIds?.filter((id) => id !== entry.id),
                  })
                }
                type="checkbox"
              />
              {entry.title} · revision {entry.revision}
              {entry.retired ? ' · stopped' : ''}
              {entry.edited ? ' · edited' : ''}
            </label>
            <p>{entry.body}</p>
            {entry.sources.length === 0 ? (
              <small>Human-authored note</small>
            ) : (
              entry.sources.map((source) => (
                <button
                  key={`${source.sessionId}/${source.messageId}`}
                  onClick={() => act(() => onSource(source.sessionId))}
                >
                  Source: {source.sessionId.slice(0, 8)} / {source.messageId.slice(0, 8)}
                </button>
              ))
            )}
            <button
              onClick={() => {
                setEditing(entry)
                setTitle(entry.title)
                setBody(entry.body)
                setSourceId('')
              }}
            >
              Edit
            </button>
            <button onClick={() => act(() => write(entry, !entry.retired))}>
              {entry.retired ? 'Restore' : 'Stop using'}
            </button>
          </article>
        ))}
        {cursor && <button onClick={() => act(() => load(cursor))}>More notes</button>}
        <details>
          <summary>{editing ? 'Edit note' : 'Add a note or save an excerpt'}</summary>
          <label>
            Title{' '}
            <input
              aria-label="Memory title"
              maxLength={256}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </label>
          {!editing && (
            <label>
              Source message{' '}
              <select
                aria-label="Memory source message"
                onChange={(event) => {
                  setSourceId(event.target.value)
                  setExcerpt('')
                }}
                value={sourceId}
              >
                <option value="">Human-authored note</option>
                {messages
                  .filter((message) => message.content)
                  .map((message) => (
                    <option key={message.id} value={message.id}>
                      {message.content.slice(0, 90)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {sourceId && (
            <label>
              Exact excerpt{' '}
              <textarea
                aria-label="Memory excerpt"
                maxLength={8192}
                onChange={(event) => setExcerpt(event.target.value)}
                value={excerpt}
              />
            </label>
          )}
          <label>
            {sourceId ? 'Edited note (optional)' : 'Note'}{' '}
            <textarea
              aria-label="Memory body"
              maxLength={8192}
              onChange={(event) => setBody(event.target.value)}
              value={body}
            />
          </label>
          <button disabled={!title.trim() || (!body && !excerpt)} onClick={() => act(() => write())}>
            Save memory
          </button>
          {editing && (
            <button
              onClick={() => {
                setEditing(undefined)
                setTitle('')
                setBody('')
              }}
            >
              Cancel edit
            </button>
          )}
        </details>
        <button
          disabled={selection.mode === 'off'}
          onClick={() =>
            act(async () => {
              const result = await api<ProjectContextSnapshot>(`/api/threads/${threadId}/memory/preview`, {
                body: JSON.stringify({mode: selection.mode, selectedIds: selection.selectedIds}),
                headers: {'Content-Type': 'application/json'},
                method: 'POST',
              })
              setPreview(result)
              onChange({...selection, expectedGeneration: result.generation})
            })
          }
        >
          Preview next run
        </button>
        {preview && (
          <div role="status">
            <p>
              {preview.tokens} tokens · generation {preview.generation}. Changes before admission require a fresh
              preview.
            </p>
            <pre>{preview.rendered}</pre>
            {preview.exclusions.map((item) => (
              <p key={item.id}>
                Excluded {item.id}: {item.reason}
              </p>
            ))}
          </div>
        )}
        <button
          onClick={() =>
            act(async () => {
              setHistory(JSON.stringify(await api(`/api/sessions/${threadId}/project-context`), null, 2))
            })
          }
        >
          Show recorded snapshots
        </button>
        {history && <pre>{history}</pre>}
      </fieldset>
    </details>
  )
}
