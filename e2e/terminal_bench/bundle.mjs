// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {command, digest, docker, repo, writeJSON} from '../host.mjs'
import {sourceFingerprint} from '../source-fingerprint.mjs'

const output = path.resolve(process.argv[2] ?? 'tmp/e2e/terminal-bench/bundle')
await fs.mkdir(output, {recursive: true})
const image = 'orbit-e2e:terminal-bench'
await docker(['build', '--platform', 'linux/amd64', '-f', 'e2e/Dockerfile', '-t', image, '.'], {
  log: path.join(output, 'build.log'),
  timeoutMs: 1_200_000,
})
const imageId = (await docker(['image', 'inspect', image, '--format', '{{.Id}}'])).stdout.trim()
const name = 'orbit-bundle-' + randomUUID()
try {
  await docker([
    'create',
    '--name',
    name,
    '--platform',
    'linux/amd64',
    '--user',
    'root',
    imageId,
    'tar',
    '-czf',
    '/tmp/orbit-bundle.tar.gz',
    '-C',
    '/opt/orbit',
    'dist',
    'node_modules',
    'e2e',
    'package.json',
    '-C',
    '/usr/local',
    'bin/node',
  ])
  await docker(['start', '-a', name], {timeoutMs: 300_000})
  await docker(['cp', `${name}:/tmp/orbit-bundle.tar.gz`, path.join(output, 'orbit-bundle.tar.gz')], {
    timeoutMs: 300_000,
  })
} finally {
  await docker(['rm', '-f', name], {allowFailure: true})
}

await writeJSON(path.join(output, 'manifest.json'), {
  bundleSha256: digest(await fs.readFile(path.join(output, 'orbit-bundle.tar.gz'))),
  dirty: Boolean((await command('git', ['status', '--porcelain'])).stdout.trim()),
  imageId,
  orbitCommit: (await command('git', ['rev-parse', 'HEAD'])).stdout.trim(),
  platform: 'linux/amd64',
  sourceSha256: await sourceFingerprint(repo),
})
console.log(output)
