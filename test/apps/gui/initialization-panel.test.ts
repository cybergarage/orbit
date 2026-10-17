// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import {InitializationPanel} from '../../../src/apps/gui/initialization-panel.js'

describe('initialization settings panel', () => {
  it('presents all three scopes, explicit settings selection and permanent versus Trash semantics', () => {
    const markup = renderToStaticMarkup(createElement(InitializationPanel, {api: async <T>() => ({}) as T}))
    for (const text of [
      'Reset settings',
      'Reset conversations, projects and schedules',
      'Reset all app settings, saved data and owned cache',
      'not move it to Trash',
      'No backup',
      'explicit selection',
      'Stop this host and review',
      'Preview without changes',
      'credentials',
      'User workspaces',
    ])
      expect(markup).contains(text)
    expect(markup).not.contains('Permanently initialize')
  })
})
