// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export {
  BuiltinToolName,
  createBashTool,
  createBuiltinTools,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createListTool,
  createReadTool,
  createWriteTool,
  getBuiltinToolNames,
  isBuiltinToolName,
  isToolProfile,
  ToolProfile,
} from './builtins/index.js'
export type {
  BashToolInput,
  BuiltinToolSelection,
  EditToolInput,
  GlobToolInput,
  GrepToolInput,
  ListToolInput,
  ReadToolInput,
  ToolProfile as ToolProfileName,
  WriteToolInput,
} from './builtins/index.js'
export {adaptInvokableTool} from './compatibility.js'
export type {InvokableTool} from './compatibility.js'
export {normalizeToolResult, rawToolInput, textToolResult, toolResultText, zodToolInput} from './definition.js'
export type {
  JsonSchema,
  ModelToolSpec,
  ToolContent,
  ToolDefinition,
  ToolExecutionContext,
  ToolInputCodec,
  ToolResult,
  ToolScheduling,
  ToolSource,
} from './definition.js'
export {ToolRegistry, ToolRuntime, ToolSnapshot} from './registry.js'
export type {ToolExecutionResult} from './registry.js'
export {tool, Tool} from './tool.js'
export type {ToolConfig, ToolContext, ToolHandler, ToolInput, ToolOptions, ToolOutput} from './tool.js'
