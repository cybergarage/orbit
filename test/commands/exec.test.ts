// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('exec', () => {
  it('runs exec with a prompt', async () => {
    const {stdout} = await runCommand(['exec', 'hello'])
    expect(stdout.trim()).to.not.be.empty
  })
})
