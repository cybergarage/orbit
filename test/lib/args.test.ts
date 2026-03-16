// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {normalizeCliArgs} from '../../bin/args.js'

describe('normalizeCliArgs', () => {
  it('routes empty argv to the hidden interactive command', () => {
    expect(normalizeCliArgs([])).to.deep.equal(['_interactive'])
  })

  it('routes flag-only argv to the hidden interactive command', () => {
    expect(normalizeCliArgs(['--lang', 'ja'])).to.deep.equal(['_interactive', '--lang', 'ja'])
  })

  it('keeps explicit commands untouched', () => {
    expect(normalizeCliArgs(['exec', 'hello'])).to.deep.equal(['exec', 'hello'])
  })

  it('keeps help requests untouched', () => {
    expect(normalizeCliArgs(['--help'])).to.deep.equal(['--help'])
  })
})
