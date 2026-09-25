// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {randomUUID} from 'node:crypto'
import path from 'node:path'

import {activeContainers, docker} from '../host.mjs'

export async function gradeBook(directory) {
  const name = `orbit-book-grade-${randomUUID()}`
  const marker = `BOOK-PASS-${randomUUID()}`
  activeContainers.add(name)
  try {
    const result = await docker(
      [
        'run',
        '--rm',
        '--init',
        '--name',
        name,
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--memory',
        '2g',
        '--cpus',
        '2',
        '--pids-limit',
        '256',
        '--tmpfs',
        '/workspace:uid=1000,gid=1000,mode=0700',
        '--tmpfs',
        '/tmp',
        '--shm-size',
        '256m',
        '--mount',
        `type=bind,src=${path.join(directory, 'workspace')},dst=/artifact,readonly`,
        '--env',
        `ORBIT_BOOK_MARKER=${marker}`,
        process.env.ORBIT_BOOK_GRADER_IMAGE ?? 'orbit-e2e:book-grader',
      ],
      {allowFailure: true, log: path.join(directory, 'grade.log'), timeoutMs: 180_000},
    )
    return {...result, passed: result.code === 0 && !result.timedOut && result.stdout.split('\n').includes(marker)}
  } finally {
    await docker(['rm', '-f', name], {allowFailure: true})
    activeContainers.delete(name)
  }
}
