// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {constants} from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export async function packagePath(root: string, file: string, kind: 'directory' | 'file'): Promise<string> {
  const resolved = await fs.realpath(file)
  if (!contained(root, resolved)) throw new Error('Package path escapes its root')
  const stat = await fs.stat(resolved)
  if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) throw new Error('Invalid package filesystem kind')
  return resolved
}

const identity = (s: {ctimeMs: number; dev: number; ino: number; mtimeMs: number; size: number}) =>
  `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`

export async function readPackageFile(root: string, file: string, limit: number): Promise<string> {
  const resolved = await packagePath(root, file, 'file')
  // Reject replacement links and special files between resolution and open.
  // eslint-disable-next-line no-bitwise
  const handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error('Invalid package file kind')
    if (before.size > limit) throw new Error('Package byte limit exceeded')
    const buffer = Buffer.alloc(limit + 1)
    let length = 0
    while (length < buffer.length) {
      // eslint-disable-next-line no-await-in-loop
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }

    if (length > limit) throw new Error('Package byte limit exceeded')
    if (
      identity(before) !== identity(await handle.stat()) ||
      resolved !== (await packagePath(root, file, 'file')) ||
      identity(before) !== identity(await fs.stat(resolved))
    )
      throw new Error('Package changed while reading')
    return new TextDecoder('utf8', {fatal: true, ignoreBOM: true}).decode(buffer.subarray(0, length))
  } finally {
    await handle.close()
  }
}
