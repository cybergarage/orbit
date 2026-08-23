// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ToolDefinition} from '../definition.js'

import {createBashTool} from './bash.js'
import {createEditTool} from './edit.js'
import {createGlobTool} from './glob.js'
import {createGrepTool} from './grep.js'
import {createListTool} from './list.js'
import {createReadTool} from './read.js'
import {createWriteTool} from './write.js'

export const BuiltinToolName = {
  Bash: 'bash',
  Edit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  List: 'list',
  Read: 'read',
  Write: 'write',
} as const

export type BuiltinToolName = (typeof BuiltinToolName)[keyof typeof BuiltinToolName]

export const ToolProfile = {
  Coding: 'coding',
  None: 'none',
} as const

export type ToolProfile = (typeof ToolProfile)[keyof typeof ToolProfile]

export interface BuiltinToolSelection {
  exclude?: BuiltinToolName[]
  include?: BuiltinToolName[]
  profile?: ToolProfile
}

const codingToolNames = Object.values(BuiltinToolName)

export function getBuiltinToolNames(): BuiltinToolName[] {
  return [...codingToolNames]
}

export function createBuiltinTools(selection: BuiltinToolSelection = {}): ToolDefinition[] {
  const selected = new Set<BuiltinToolName>(selection.profile === ToolProfile.Coding ? codingToolNames : [])
  for (const name of selection.include ?? []) selected.add(name)
  for (const name of selection.exclude ?? []) selected.delete(name)
  return codingToolNames.filter((name) => selected.has(name)).map((name) => createBuiltinTool(name))
}

export function isBuiltinToolName(value: unknown): value is BuiltinToolName {
  return typeof value === 'string' && codingToolNames.includes(value as BuiltinToolName)
}

export function isToolProfile(value: unknown): value is ToolProfile {
  return value === ToolProfile.Coding || value === ToolProfile.None
}

function createBuiltinTool(name: BuiltinToolName): ToolDefinition {
  switch (name) {
    case BuiltinToolName.Bash: {
      return createBashTool()
    }

    case BuiltinToolName.Edit: {
      return createEditTool()
    }

    case BuiltinToolName.Glob: {
      return createGlobTool()
    }

    case BuiltinToolName.Grep: {
      return createGrepTool()
    }

    case BuiltinToolName.List: {
      return createListTool()
    }

    case BuiltinToolName.Read: {
      return createReadTool()
    }

    case BuiltinToolName.Write: {
      return createWriteTool()
    }
  }
}

export {createBashTool} from './bash.js'
export type {BashToolInput} from './bash.js'
export {createEditTool} from './edit.js'
export type {EditToolInput} from './edit.js'
export {createGlobTool} from './glob.js'
export type {GlobToolInput} from './glob.js'
export {createGrepTool} from './grep.js'
export type {GrepToolInput} from './grep.js'
export {createListTool} from './list.js'
export type {ListToolInput} from './list.js'
export {createReadTool} from './read.js'
export type {ReadToolInput} from './read.js'
export {createWriteTool} from './write.js'
export type {WriteToolInput} from './write.js'
