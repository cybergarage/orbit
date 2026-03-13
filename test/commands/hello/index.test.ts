// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('hello', () => {
  it('runs hello', async () => {
    const {stdout} = await runCommand('hello friend --from oclif')
    expect(stdout).to.contain('hello friend from oclif!')
  })
})
