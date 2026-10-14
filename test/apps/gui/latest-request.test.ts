// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {LatestRequest} from '../../../src/apps/gui/latest-request.js'

describe('GUI authoritative reads', () => {
  it('does not replace a newer pause response with an older poll', async () => {
    const reads = new LatestRequest()
    let release!: (value: string) => void
    let current = ''
    const previous = reads.read(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
      (value) => {
        current = value
      },
    )
    await reads.read(
      async () => 'paused',
      (value) => {
        current = value
      },
    )
    release('active')
    await previous
    expect(current).equal('paused')
  })

  it('does not surface a stale failed poll after a newer successful read', async () => {
    const reads = new LatestRequest()
    let reject!: (error: Error) => void
    let error = false
    const previous = reads
      .read(
        () =>
          new Promise<string>((_resolve, fail) => {
            reject = fail
          }),
        () => {},
      )
      .catch(() => {
        error = true
      })
    await reads.read(
      async () => 'current',
      () => {},
    )
    reject(new Error('old network failure'))
    await previous
    expect(error).equal(false)
  })

  it('discards pending responses after navigation invalidates the view', async () => {
    const reads = new LatestRequest()
    let release!: (value: string) => void
    let applied = false
    const previous = reads.read(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
      () => {
        applied = true
      },
    )
    reads.invalidate()
    release('late')
    await previous
    expect(applied).equal(false)
  })
})
