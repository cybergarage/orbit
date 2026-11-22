// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

const integer = '(?:0|[1-9][0-9]*)'
const supportedVersion = new RegExp(String.raw`^${integer}\.${integer}\.${integer}(-next\.${integer})?$`, 'u')

export function releaseChannel(manifest, tag, release) {
  if (manifest?.name !== '@cybergarage/orbit') throw new Error('Unexpected package name')
  if (manifest.publishConfig?.tag !== undefined) throw new Error('Package must not override the workflow dist-tag')
  const {version} = manifest
  const match = typeof version === 'string' ? supportedVersion.exec(version) : null
  if (!match || match[0] !== version || version === '0.0.0') {
    throw new Error('Expected a stable X.Y.Z or prerelease X.Y.Z-next.N version, not 0.0.0')
  }

  if (tag !== `v${version}`) throw new Error('Release tag does not match the package version')
  const prerelease = Boolean(match[1])
  if (release !== undefined &&
    (release?.tagName !== tag || release.isDraft !== false || release.isPrerelease !== prerelease)) {
    throw new Error('Expected a published GitHub release with the matching tag and prerelease flag')
  }

  return prerelease ? 'next' : 'latest'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, tag] = process.argv.slice(2)
  if (!['published', 'source'].includes(mode) || !tag || process.argv.length !== 4) {
    throw new Error('Expected source or published mode and one GitHub tag')
  }

  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  const release = mode === 'published' ? JSON.parse(readFileSync(0, 'utf8')) : undefined
  console.log(releaseChannel(manifest, tag, release))
}
