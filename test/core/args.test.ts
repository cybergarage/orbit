// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {normalizeCliArgs} from '../../bin/args.js'

describe('normalizeCliArgs', () => {
  it('routes empty argv to the hidden interactive command when stdin is a TTY', () => {
    expect(normalizeCliArgs([], true)).to.deep.equal(['_interactive'])
  })

  it('routes empty argv to exec when stdin is not a TTY', () => {
    expect(normalizeCliArgs([], false)).to.deep.equal(['exec'])
  })

  it('routes empty argv to exec when stdin TTY is undefined', () => {
    expect(normalizeCliArgs([])).to.deep.equal(['exec'])
  })

  it('routes flag-only argv to the hidden interactive command when stdin is a TTY', () => {
    expect(normalizeCliArgs(['--lang', 'ja'], true)).to.deep.equal(['_interactive', '--lang', 'ja'])
  })

  it('routes flag-only argv to exec when stdin is not a TTY', () => {
    expect(normalizeCliArgs(['--lang', 'ja'], false)).to.deep.equal(['exec', '--lang', 'ja'])
  })

  it('routes flag-only argv to exec when stdin TTY is undefined', () => {
    expect(normalizeCliArgs(['--lang', 'ja'])).to.deep.equal(['exec', '--lang', 'ja'])
  })

  it('keeps explicit commands untouched', () => {
    expect(normalizeCliArgs(['exec', 'hello'], false)).to.deep.equal(['exec', 'hello'])
  })

  it('keeps help requests untouched', () => {
    expect(normalizeCliArgs(['--help'], false)).to.deep.equal(['--help'])
  })
})
