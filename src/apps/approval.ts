// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import process from 'node:process'
import readline from 'node:readline'

import type {ApprovalRequest} from '../core/execution/run.js'

/** Non-interactive applications must supply a policy instead of silently granting an ask. */
export async function confirmOperation(request: ApprovalRequest, signal: AbortSignal): Promise<boolean> {
  if (!process.stdin.isTTY || signal.aborted) return false
  const terminal = readline.createInterface({input: process.stdin, output: process.stderr})
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (approved: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      terminal.close()
      resolve(approved)
    }

    const cancel = () => finish(false)
    const timer = setTimeout(cancel, Math.max(0, request.expiresAt - Date.now()))
    signal.addEventListener('abort', cancel, {once: true})
    terminal.once('close', cancel)
    terminal.question(`${JSON.stringify(request.preview, null, 2)}\nApprove this operation once? [y/N] `, (answer) =>
      finish(/^(?:y|yes)$/iu.test(answer.trim())),
    )
  })
}
