#!/usr/bin/env node
// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- cp is available on the minimum Node 20.19, though marked experimental there.
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = await mkdtemp(path.join(os.tmpdir(), 'orbit-package-'))
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this check with npm run test:package')
function runNpm(args, cwd, capture = false) {
  return execFileSync(process.execPath, [npm, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
}

try {
  const output = runNpm(['pack', '--json', '--pack-destination', temporary], root, true)
  // npm forwards lifecycle stdout before its JSON result.
  const start = output.search(/^\[\s*$/mu)
  assert.ok(start >= 0, 'npm pack did not return a JSON file list')
  const [packed] = JSON.parse(output.slice(start))
  assert.equal(packed.name, '@cybergarage/orbit')
  const files = new Set(packed.files.map((file) => file.path))
  for (const required of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/apps/gui/public/client.js',
    'bin/run.js',
    'bin/args.js',
    'oclif.manifest.json',
  ]) {
    assert.ok(files.has(required), `Missing package file: ${required}`)
  }

  for (const file of files) {
    assert.ok(
      !/(^|\/)(\.env(?:\..*)?|\.npmrc|\.git|node_modules)(\/|$)/u.test(file),
      `Unexpected package file: ${file}`,
    )
  }

  const consumer = path.join(temporary, 'consumer')
  await cp(path.join(root, 'examples/assistant'), consumer, {
    filter: (source) => !['.assistant', 'dist', 'node_modules', 'workspace'].includes(path.basename(source)),
    recursive: true,
  })
  const manifestPath = path.join(consumer, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.dependencies['@cybergarage/orbit'], packed.version, 'Example must pin the release version')
  manifest.dependencies['@cybergarage/orbit'] = `file:${path.join(temporary, packed.filename)}`
  // Match the repository's tested compiler and declarations for this consumer check.
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  for (const name of Object.keys(manifest.devDependencies)) {
    manifest.devDependencies[name] = lock.packages[`node_modules/${name}`].version
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer)
  runNpm(['run', 'build'], consumer)
  runNpm(['test'], consumer)
  execFileSync(process.execPath, ['node_modules/@cybergarage/orbit/bin/run.js', '--help'], {
    cwd: consumer,
    stdio: 'inherit',
  })
  if (process.env.ORBIT_RELEASE_DIR) {
    const destination = path.resolve(process.env.ORBIT_RELEASE_DIR)
    await mkdir(destination, {recursive: true})
    await cp(path.join(temporary, packed.filename), path.join(destination, packed.filename))
    console.log(`Verified tarball saved to ${destination}`)
  }

  console.log(`Package verified: ${packed.filename} (${packed.files.length} files)`)
} finally {
  await rm(temporary, {force: true, recursive: true})
}
