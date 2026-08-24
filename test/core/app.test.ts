// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {APP_NAME, configureApp, DOT_APP_DIR_NAME, logsDir, sessionsDir, setAppName} from '../../src/core/index.js'

describe('app config', () => {
  afterEach(() => {
    configureApp({appName: 'orbit'})
  })

  it('uses orbit defaults', () => {
    expect(APP_NAME).to.equal('orbit')
    expect(DOT_APP_DIR_NAME).to.equal('.orbit')
  })

  it('updates the dot app directory when the app name changes', () => {
    setAppName('acme')

    expect(APP_NAME).to.equal('acme')
    expect(DOT_APP_DIR_NAME).to.equal('.acme')
  })

  it('configures the app name and derived dot app directory at once', () => {
    configureApp({appName: 'acme'})

    expect(APP_NAME).to.equal('acme')
    expect(DOT_APP_DIR_NAME).to.equal('.acme')
  })

  it('stores sessions under the user dot application directory', () => {
    expect(sessionsDir()).to.equal(path.join(os.homedir(), '.orbit', 'sessions'))

    setAppName('acme')

    expect(sessionsDir()).to.equal(path.join(os.homedir(), '.acme', 'sessions'))
  })

  it('stores logs under the user dot application directory', () => {
    const override = process.env.ORBIT_LOG_DIR
    delete process.env.ORBIT_LOG_DIR
    try {
      expect(logsDir()).to.equal(path.join(os.homedir(), '.orbit', 'logs'))

      setAppName('acme')

      expect(logsDir()).to.equal(path.join(os.homedir(), '.acme', 'logs'))
    } finally {
      if (override !== undefined) process.env.ORBIT_LOG_DIR = override
    }
  })

  it('allows the log root to be overridden for isolated runtimes', () => {
    expect(logsDir()).to.equal(path.resolve(process.env.ORBIT_LOG_DIR as string))
  })
})
