// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {buttons, type Element, renderWorkspaceComponent} from './fixtures/workspace-render.js'

function form(onCreate: (value: unknown) => Promise<void>): Promise<Element> {
  return renderWorkspaceComponent('TaskForm', {busy: false, onCancel() {}, onCreate})
}

describe('GUI scheduled task form', () => {
  it('submits once through the handled creation callback and prevents native navigation', async () => {
    const values: unknown[] = []
    let prevented = false
    const element = await form(async (value) => {
      values.push(value)
    })
    expect(
      element.props.onSubmit!({
        preventDefault() {
          prevented = true
        },
      }),
    ).equal(undefined)
    expect(prevented).equal(true)
    expect(values).have.length(1)
    expect(values[0]).have.nested.property('task.permissions', 'workspace-read')
  })

  it('explicitly submits from Create and keeps Cancel outside form submission', async () => {
    const controls = buttons(await form(async () => {})).slice(-2)
    expect(controls.map((button) => button.props.type)).deep.equal(['button', 'submit'])
    expect(controls.every((button) => button.props.disabled === false)).equal(true)
  })
})
