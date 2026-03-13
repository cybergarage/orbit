// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('hello world', () => {
  it('runs hello world cmd', async () => {
    const {stdout} = await runCommand('hello world')
    expect(stdout).to.contain('hello world!')
  })
})
