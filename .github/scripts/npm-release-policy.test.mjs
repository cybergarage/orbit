// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {test as nodeTest} from 'node:test'

import {releaseChannel} from './npm-release-policy.mjs'

const manifest = (version) => ({name: '@cybergarage/orbit', version})
const release = (tagName, isPrerelease, isDraft = false) => ({isDraft, isPrerelease, tagName})

nodeTest('stable tags route to latest and next prereleases route to next', () => {
  assert.equal(releaseChannel(manifest('0.9.3'), 'v0.9.3'), 'latest')
  assert.equal(releaseChannel(manifest('0.9.3'), 'v0.9.3', release('v0.9.3', false)), 'latest')
  assert.equal(releaseChannel(manifest('0.9.4-next.0'), 'v0.9.4-next.0'), 'next')
  assert.equal(releaseChannel(manifest('0.9.4-next.0'), 'v0.9.4-next.0', release('v0.9.4-next.0', true)), 'next')
})

nodeTest('malformed, unsupported and placeholder versions cannot select any channel', () => {
  for (const version of ['0.0.0', '0.9.4-next', '0.9.4-next.00', '0.9.4-beta.0', '0.9.4+private', '01.9.4', '0.9.4\n', null]) {
    assert.throws(() => releaseChannel(manifest(version), `v${version}`), /Expected a stable/)
  }

  assert.throws(() => releaseChannel(manifest('0.9.4-next.0'), 'v0.9.4'), /does not match/)
  assert.throws(() => releaseChannel({...manifest('0.9.3'), name: '@example/orbit'}, 'v0.9.3'), /Unexpected package name/)
  assert.throws(
    () => releaseChannel({...manifest('0.9.4-next.0'), publishConfig: {tag: 'latest'}}, 'v0.9.4-next.0'),
    /must not override/,
  )
})

nodeTest('wrong release tag, mismatched metadata and draft releases fail closed', () => {
  const tag = 'v0.9.4-next.0'
  for (const metadata of [release(tag, false), release(tag, true, true), release('v0.9.3', true), {tagName: tag}, null]) {
    assert.throws(() => releaseChannel(manifest('0.9.4-next.0'), tag, metadata), /published GitHub release/)
  }

  assert.throws(() => releaseChannel(manifest('0.9.3'), 'v0.9.3', release('v0.9.3', true)), /published GitHub release/)
})
