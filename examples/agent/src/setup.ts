// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {mkdir} from 'node:fs/promises'
import {parseArgs} from 'node:util'

import {examplePaths, repositoryFor} from './host.js'

const {values} = parseArgs({options: {offline: {type: 'boolean'}}})
if (!values.offline) {
  throw new Error(
    'Stop all writers and automatic restarters, take exclusive control of these roots, then pass --offline. See README.md.',
  )
}

const {dataDir, workspace} = examplePaths()
await mkdir(workspace, {recursive: true})
repositoryFor(dataDir).initializeStorage({
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  exclusiveStorageControl: true,
})
console.log(`Storage initialized at ${dataDir}; workspace: ${workspace}`)
