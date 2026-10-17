// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {buttons, renderWorkspaceComponent} from './fixtures/workspace-render.js'

describe('GUI schedule controls', () => {
  it('requires confirmation and sends only schedule deletion while retaining run history', async () => {
    const requests: unknown[] = []
    const schedule = {
      id: 'fixture',
      interval: 1000,
      next: 9000,
      paused: true,
      payload: {name: 'Synthetic', workspace: '/synthetic'},
    }
    const state = {attempts: [], occurrences: [], runs: [], schedules: [schedule]}
    const api = async (url: string, init?: {method?: string}) => {
      requests.push({method: init?.method, url})
      return state
    }

    const unconfirmed = buttons(
      await renderWorkspaceComponent('ScheduledWorkspace', {api, closeDrawer() {}}, [state, 'fixture']),
    )
    expect(unconfirmed.some((button) => button.props.children === 'Confirm delete')).equal(false)
    expect(requests).length(0)
    const confirmed = buttons(
      await renderWorkspaceComponent('ScheduledWorkspace', {api, closeDrawer() {}}, [
        state,
        'fixture',
        false,
        undefined,
        undefined,
        false,
        'fixture',
      ]),
    )
    const deletion = confirmed.find((button) => button.props.children === 'Confirm delete')!
    await deletion.props.onClick!()
    expect(requests[0]).deep.equal({method: 'DELETE', url: '/api/schedules/fixture'})
    expect(requests).length(2)
  })
})
