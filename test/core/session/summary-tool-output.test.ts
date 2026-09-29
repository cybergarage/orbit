// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {PersistedMessage} from '../../../src/core/session/entries.js'

import {projectSummaryToolOutput, restoreSummaryToolOutput} from '../../../src/core/session/summary-tool-output.js'

function message(output: unknown): PersistedMessage {
  return {
    contents: [],
    id: 'tool-source',
    parentid: 'call-source',
    payload: {output},
    role: 'assistant',
    timestamp: '2026-09-29T00:00:00.000Z',
    type: 'tool',
  } as PersistedMessage
}

describe('Lossless summary tool-output rendering', () => {
  it('restores both streams, Unicode offsets, whitespace, status and custom data without mutation', () => {
    const stdout = '  😀 output\r\n'.repeat(100)
    const stderr = 'error\n'.repeat(100)
    const original = message({
      content: [
        {data: 'fake', mediaType: 'image/png', type: 'image'},
        {text: 'prefix😀' + stdout + stderr + '[exit 5]', type: 'text'},
      ],
      details: {
        custom: {encoding: 'orbit-tool-output-references-v1', streams: {}},
        exitCode: 5,
        stderr,
        stdout,
        timedOut: true,
        truncated: true,
      },
      isError: true,
    })
    const snapshot = JSON.stringify(original)
    const projected = projectSummaryToolOutput(original)
    expect(projected).not.to.equal(original)
    expect(Buffer.byteLength(JSON.stringify(projected))).to.be.lessThan(Buffer.byteLength(snapshot))
    expect(restoreSummaryToolOutput(projected, original)).to.deep.equal(original)
    expect(JSON.stringify(original)).to.equal(snapshot)
  })

  it('retains short, empty, missing and unmatched streams literally', () => {
    for (const details of [
      {stderr: '', stdout: 'short'},
      {stdout: 'different'.repeat(100)},
      {stderr: 'not present'},
      {other: 1},
    ]) {
      const original = message({content: [{text: 'short', type: 'text'}], details})
      expect(projectSummaryToolOutput(original)).to.equal(original)
    }
  })

  it('does not merge separated blocks, trim streams or interpret existing reference-shaped outputs', () => {
    for (const output of [
      {
        content: [
          {text: 'a'.repeat(100), type: 'text'},
          {text: 'b'.repeat(100), type: 'text'},
        ],
        details: {stdout: 'a'.repeat(100) + '\n' + 'b'.repeat(100)},
      },
      {content: [{text: 'a'.repeat(300), type: 'text'}], details: {stdout: 'a'.repeat(300) + '\n'}},
      {encoding: 'orbit-tool-output-references-v1', streams: {}, value: {}},
    ]) {
      const original = message(output)
      expect(projectSummaryToolOutput(original)).to.equal(original)
      expect(restoreSummaryToolOutput(original, original)).to.equal(original)
    }
  })

  it('preserves independent identities when both streams contain identical repeated text', () => {
    const text = 'same\n'.repeat(200)
    const original = message({content: [{text: text + text, type: 'text'}], details: {stderr: text, stdout: text}})
    expect(restoreSummaryToolOutput(projectSummaryToolOutput(original), original)).to.deep.equal(original)
  })
})
