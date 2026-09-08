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

  it('routes all supported value flags without treating their values as commands', () => {
    const argv = [
      '--ollama-host',
      'http://127.0.0.1:11435',
      '--openai-api-key-env',
      'BOOK_FAKE_OPENAI_KEY',
      '--anthropic-api-key-env',
      'BOOK_FAKE_ANTHROPIC_KEY',
      '--execution-policy',
      'workspace-confirm',
      '--journal-level',
      'file-sync',
      '--model',
      'test-model',
      '--provider',
      'ollama',
      '--lang',
      'ja',
    ]
    expect(normalizeCliArgs(argv, true)).to.deep.equal(['_interactive', ...argv])
    expect(normalizeCliArgs(argv, false)).to.deep.equal(['exec', ...argv])
    expect(normalizeCliArgs(['exec', ...argv, 'inspect'], false)).to.deep.equal(['exec', ...argv, 'inspect'])
    expect(normalizeCliArgs(['--help', ...argv], true)).to.deep.equal(['--help', ...argv])
  })

  it('keeps equals-form values together when selecting the implicit command', () => {
    const argv = ['--ollama-host=http://127.0.0.1:11435', '--execution-policy=workspace-confirm']
    expect(normalizeCliArgs(argv, true)).to.deep.equal(['_interactive', ...argv])
  })

  it('keeps explicit commands untouched', () => {
    expect(normalizeCliArgs(['exec', 'hello'], false)).to.deep.equal(['exec', 'hello'])
  })

  it('keeps help requests untouched', () => {
    expect(normalizeCliArgs(['--help'], false)).to.deep.equal(['--help'])
  })
})
