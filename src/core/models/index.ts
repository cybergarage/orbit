// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export {AgentEventType} from '../agent-events.js'
export type {
  AgentEvent,
  AgentEventHandler,
  AgentMessageCompletedEvent,
  AgentModelStartedEvent,
  AgentToolCompletedEvent,
  AgentToolStartedEvent,
  AgentToolUpdatedEvent,
} from '../agent-events.js'
export {Agent} from '../agent.js'
export type {AgentInvokeOptions, AgentOptions, AgentTool} from '../agent.js'
export {
  ContextOverflowError,
  IncompleteModelResponseError,
  InvalidConfigurationError,
  InvalidInputError,
  ModelAbortError,
  OperatorSequenceEmptyError,
  OrbitError,
  OrbitErrorCode,
} from '../errors/index.js'
export type {OrbitErrorOptions} from '../errors/index.js'
export {createLogger, createNoopLogger} from '../logger/index.js'
export type {LogFields, Logger, LoggerBindings, LoggerOptions, LogLevel, LogMethod, LogValue} from '../logger/index.js'
export {createMcpClient, createMcpToolManager, createMcpTransport, mcpToolName} from '../mcp.js'
export type {
  McpClient,
  McpClientFactory,
  McpToolDefinition,
  McpToolManager,
  McpToolManagerFactoryOptions,
  McpToolManagerOptions,
  McpTransportFactory,
} from '../mcp.js'
export {Message, MessageType, UserMessage} from '../message/index.js'
export type {MessageOptions, MessagePayload} from '../message/index.js'
export {OperatorSequence, ProcessorRegistry} from '../processor/index.js'
export {OperatorType} from '../processor/index.js'
export type {
  Operator,
  OperatorInput,
  OperatorOptions,
  OperatorOutput,
  Processor,
  ProcessorInput,
  ProcessorOptions,
  ProcessorOutput,
  ProcessorType,
} from '../processor/index.js'
export {PromptTemplate} from '../prompts/template.js'
export type {PromptTemplateInput} from '../prompts/template.js'
export {Session, SessionContextBuilder, SessionHeader, SessionRepository} from '../session/index.js'
export type {
  SessionHeaderOptions,
  SessionModelContext,
  SessionOptions,
  SessionRepositoryOptions,
  SessionSummary,
} from '../session/index.js'
export type {
  McpServerSettings,
  McpSettings,
  ProviderConnectionSettings,
  ProviderSettings,
  ToolSettings,
  WorkspaceSettings,
} from '../settings.js'
export {Skill} from '../skills/index.js'
export type {SkillConfig, SkillMetadata, SkillSource, SkillSourceInfo} from '../skills/index.js'
export {State} from '../state.js'
export {tool, Tool, ToolProfile} from '../tools/index.js'
export type {ToolConfig, ToolContext, ToolHandler, ToolInput, ToolOptions, ToolOutput} from '../tools/index.js'
export {resolveModelContextCapacity} from './context-capacity.js'
export type {ModelContextCapacity, ModelContextInfo, ModelContextOptions} from './context-capacity.js'
export {DEFAULT_MODELS, getModel, getModelRegistry, ModelRegistry, registerModelProvider} from './factory.js'
export type {ModelProviderRegistration} from './factory.js'
export type {
  Model,
  ModelAssistantPayload,
  ModelInvokeOptions,
  ModelOutputPart,
  ModelResponseMetadata,
  ModelTokenUsage,
  ModelToolCall,
  ModelToolCallPayload,
  ModelToolResultPayload,
} from './model.js'
export type {PreparedModelInvocation} from './model.js'
export type {Prompt} from './prompt.js'
export {splitSystemPrompt} from './prompt.js'
export type {Provider, ProviderName} from './provider.js'
export {createProvider, getProvider, getProviderNames, isProvider, isProviderName} from './provider.js'

export {getRoles, Role} from './role.js'
