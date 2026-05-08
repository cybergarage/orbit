// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {APP_NAME, configureApp, DOT_APP_DIR_NAME, setAppName} from '../../src/core/index.js'

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
})
