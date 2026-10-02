// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

import type {RunContext} from './run.js'

/** Internal coordination shared by all executors in this loaded module instance. */
class ResourceCoordinator {
  private readonly resourceOwners = new Map<string, RunContext>()
  private readonly serverOwners = new Map<string, RunContext>()

  acquirePaths(run: RunContext, resources: readonly string[]): boolean {
    for (const resource of resources)
      for (const [reserved, owner] of this.resourceOwners)
        if (owner !== run && (overlaps(resource, reserved) || overlaps(reserved, resource))) return false

    for (const resource of resources)
      if (!this.resourceOwners.has(resource)) {
        this.resourceOwners.set(resource, run)
        run.retain(() => {
          if (this.resourceOwners.get(resource) === run) this.resourceOwners.delete(resource)
        })
      }

    return true
  }

  acquireServer(run: RunContext, server: string): boolean {
    const owner = this.serverOwners.get(server)
    if (owner && owner !== run) return false
    if (!owner) {
      this.serverOwners.set(server, run)
      run.retain(() => {
        if (this.serverOwners.get(server) === run) this.serverOwners.delete(server)
      })
    }

    return true
  }
}

// Intentionally not exported through the public package: replacing or resetting
// this coordinator would split ownership between otherwise conflicting Runs.
export const operationResources = new ResourceCoordinator()

function overlaps(left: string, right: string): boolean {
  const relative = path.relative(left, right)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
