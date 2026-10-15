// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import type {ApprovalRequest} from '../../../src/core/execution/run.js'

import {ApprovalDialog} from '../../../src/apps/gui/approval-dialog.js'

const approval: ApprovalRequest = {
  digest: 'bound-digest',
  expiresAt: 2000,
  id: 'request',
  operationId: 'operation',
  parentPhase: 'running',
  preview: {content: '<script>untrusted</script>', name: 'write', path: '/synthetic/answer.txt'},
  responderScope: 'local-gui',
  runId: 'run',
  sessionId: 'session',
}
const render = (now: number, busy = false, request: ApprovalRequest | undefined = approval) =>
  renderToStaticMarkup(
    createElement(ApprovalDialog, {
      approval: request,
      busy,
      now,
      onClose() {},
      async onReply() {},
      returnFocus() {},
    }),
  )

describe('GUI approval dialog', () => {
  it('shows the bound operation and target and escapes untrusted preview text', () => {
    const markup = render(1000)
    expect(markup).contains('role="dialog"').contains('aria-modal="true"')
    expect(markup).contains('Target: /synthetic/answer.txt').contains('Operation preview')
    expect(markup).contains('&lt;script&gt;untrusted&lt;/script&gt;').not.contains('<script>')
    expect(markup.match(/disabled=""/g) ?? []).length(0)
    expect(markup).contains('Deny').contains('Approve once').contains('Close')
  })

  it('disables both decisions at the expiry boundary and while a decision is pending', () => {
    expect(render(2000).match(/disabled=""/g)).length(2)
    expect(render(2000)).contains('This request has expired')
    expect(render(1000, true).match(/disabled=""/g)).length(2)
    expect(render(1000, true)).contains('Submitting decision')
  })

  it('renders no approval controls without an authoritative request', () => {
    expect(
      renderToStaticMarkup(
        createElement(ApprovalDialog, {busy: false, now: 0, onClose() {}, async onReply() {}, returnFocus() {}}),
      ),
    ).equal('')
  })
})
