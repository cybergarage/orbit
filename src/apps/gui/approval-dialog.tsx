// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* global document, HTMLDialogElement, HTMLElement, KeyboardEvent */
import {useEffect, useRef} from 'react'

import type {ApprovalRequest} from '../../core/execution/run.js'

/** Dismissal changes presentation only; the runtime remains the approval authority. */
export function ApprovalDialog({
  approval,
  busy,
  error,
  now,
  onClose,
  onReply,
  returnFocus,
}: Readonly<{
  approval?: ApprovalRequest
  busy: boolean
  error?: string
  now: number
  onClose: (id: string) => void
  onReply: (id: string, digest: string, approve: boolean) => Promise<void>
  returnFocus: () => void
}>) {
  const panel = useRef<HTMLDialogElement>(null)
  const callbacks = useRef({onClose, returnFocus})
  callbacks.current = {onClose, returnFocus}
  useEffect(() => {
    if (!approval) return
    const dialog = panel.current
    if (!dialog) return
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    dialog.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        callbacks.current.onClose(approval.id)
      }

      if (event.key !== 'Tab') return
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary') ?? [])]
      const first = controls[0]
      const last = controls.at(-1)
      if (
        event.shiftKey &&
        (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))
      ) {
        event.preventDefault()
        last?.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))
      ) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      dialog.close()
      if (previous?.isConnected) previous.focus()
      callbacks.current.returnFocus()
    }
  }, [approval?.id])
  if (!approval) return null
  const expired = approval.expiresAt <= now
  return (
    <dialog
      aria-describedby="approval-scope"
      aria-labelledby="approval-title"
      aria-modal="true"
      className="dialog approval-dialog"
      onCancel={(event) => {
        event.preventDefault()
        onClose(approval.id)
      }}
      ref={panel}
      tabIndex={-1}
    >
      <h2 id="approval-title">Confirm one operation</h2>
      <div className="approval-operation">
        <strong>{typeof approval.preview.name === 'string' ? approval.preview.name : 'Operation'}</strong>
        {typeof approval.preview.path === 'string' && <p>Target: {approval.preview.path}</p>}
        {typeof approval.preview.cwd === 'string' && <p>Working directory: {approval.preview.cwd}</p>}
        {typeof approval.preview.command === 'string' && <pre>{approval.preview.command}</pre>}
        <details open={typeof approval.preview.name !== 'string' || undefined}>
          <summary>Operation preview</summary>
          <pre>{JSON.stringify(approval.preview, null, 2)}</pre>
        </details>
      </div>
      <p id="approval-scope">
        Approval applies to this operation once. Expires {new Date(approval.expiresAt).toLocaleTimeString()}.
      </p>
      {expired && (
        <output className="approval-status">This request has expired. Waiting for the run to refresh.</output>
      )}
      {busy && <output className="approval-status">Submitting decision…</output>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button onClick={() => onClose(approval.id)}>Close</button>
        <button disabled={busy || expired} onClick={() => onReply(approval.id, approval.digest, false)}>
          Deny
        </button>
        <button
          className="approve-once"
          disabled={busy || expired}
          onClick={() => onReply(approval.id, approval.digest, true)}
        >
          Approve once
        </button>
      </div>
    </dialog>
  )
}
