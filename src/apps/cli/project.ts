// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import type {Project, ProjectService} from '../../core/index.js'

import {SessionRepository} from '../../core/index.js'
import {withProjectCatalog} from '../project-catalog.js'
import {confirmProjectDeletion} from '../project-confirmation.js'

export interface ProjectCommandOptions {
  after?: string
  archive?: 'active' | 'all' | 'archived'
  confirm?: (project: Project) => Promise<boolean>
  force?: boolean
  limit?: number
}

export async function runProjectCommand(
  service: ProjectService,
  action: string,
  id: string | undefined = undefined,
  options: ProjectCommandOptions = {},
): Promise<unknown> {
  if (options.archive !== undefined && !['active', 'all', 'archived'].includes(options.archive))
    throw new Error('Invalid archive filter.')
  if (options.force && action !== 'delete') throw new Error('--force is only available for deletion.')
  if (action === 'list') {
    if (id !== undefined) throw new Error('Project list does not accept an ID.')
    const archive = options.archive ?? 'all'
    return service.store.query({
      after: options.after,
      ...(archive === 'all' ? {} : {archived: archive === 'archived'}),
      kind: 'projects',
      limit: options.limit ?? 50,
    })
  }

  if (!id) throw new Error(`Project ${action} requires an exact project ID.`)
  if (action === 'sessions') return service.listSessions(id, options)
  if (!['archive', 'delete', 'unarchive'].includes(action)) throw new Error(`Unknown project action: ${action}`)
  if (options.archive !== undefined || options.after !== undefined || options.limit !== undefined)
    throw new Error('Listing flags require project list or project sessions.')
  const project = await service.store.query({id, kind: 'project'})
  if (!project) throw new Error(`Unknown project: ${id}`)
  const operation = {expectedRevision: project.revision, operationId: randomUUID()}
  if (action === 'delete') {
    const confirmed = options.force === true || (await (options.confirm ?? confirmProjectDeletion)(project))
    if (!confirmed) return {deleted: false, project}
    return {deleted: true, project: await service.delete(id, operation)}
  }

  return service.update(id, {
    ...operation,
    archived: action === 'archive',
    directory: project.defaultDirectory,
    name: project.name,
  })
}

export default class ProjectCommand extends Command {
  static args = {
    action: Args.string({options: ['list', 'sessions', 'archive', 'unarchive', 'delete'], required: true}),
    project: Args.string({description: 'Exact project ID (required except for list)'}),
  }
  static description = 'List projects or archive, unarchive, or permanently delete an empty project'
  static examples = [
    '<%= config.bin %> project list --archive archived',
    '<%= config.bin %> project sessions <PROJECT_ID> --archive all',
    '<%= config.bin %> project archive <PROJECT_ID>',
    '<%= config.bin %> project unarchive <PROJECT_ID>',
    '<%= config.bin %> project delete <PROJECT_ID> --force',
  ]
  static flags = {
    after: Flags.string({description: 'Exclusive project/session ID cursor for listings'}),
    archive: Flags.string({
      description: 'Archive state for listings (omission includes all)',
      options: ['active', 'archived', 'all'],
    }),
    force: Flags.boolean({description: 'Confirm empty-project deletion without prompting'}),
    limit: Flags.integer({description: 'Listing page size', max: 200, min: 1}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ProjectCommand)
    try {
      const result = await withProjectCatalog(new SessionRepository(), (service) =>
        runProjectCommand(service, args.action, args.project, {
          ...flags,
          archive: flags.archive as ProjectCommandOptions['archive'],
        }),
      )
      this.log(JSON.stringify(result, null, 2))
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Project operation failed.')
    }
  }
}
