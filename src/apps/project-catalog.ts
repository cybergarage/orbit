// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import {ProjectService, SessionRepository, SqliteProjectStore} from '../core/index.js'

/** Opens the same catalog as the GUI without resolving models or connecting tools. */
export async function withProjectCatalog<T>(
  repository: SessionRepository,
  action: (service: ProjectService) => Promise<T>,
  optional = false,
): Promise<T | undefined> {
  const file = path.join(path.dirname(repository.rootDir), 'projects.sqlite')
  if (optional) {
    try {
      await fs.lstat(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }

  const store = await SqliteProjectStore.open({file})
  try {
    return await action(
      new ProjectService(
        store,
        repository,
        {
          // This command owns no threads; writer and journal guards detect other processes.
          async closeThread() {},
          getThread(): undefined {},
        },
        process.cwd(),
      ),
    )
  } finally {
    await store.close()
  }
}
