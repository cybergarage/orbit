// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const sources = [
  'bin/build-gui.mjs',
  'e2e/source-fingerprint.mjs',
  'e2e/worker.mjs',
  'package-lock.json',
  'package.json',
  'src',
  'tsconfig.json',
]

export async function sourceFingerprint(root) {
  const hash = createHash('sha256')
  const add = async (relative) => {
    const absolute = path.join(root, relative)
    const entry = await fs.lstat(absolute)
    if (entry.isDirectory()) {
      for (const child of (await fs.readdir(absolute)).sort()) await add(path.join(relative, child))
      return
    }

    if (!entry.isFile()) throw new Error(`Unsupported source entry: ${relative}`)
    const contents = await fs.readFile(absolute)
    hash.update(relative.split(path.sep).join('/')).update('\0')
    hash.update(String(contents.length)).update('\0').update(contents).update('\0')
  }

  for (const source of sources) await add(source)
  return hash.digest('hex')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  console.log(await sourceFingerprint(path.resolve(import.meta.dirname, '..')))
