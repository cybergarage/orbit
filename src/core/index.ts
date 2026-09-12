// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export {AgentEventType} from './agent-events.js'
export type {
  AgentEvent,
  AgentEventHandler,
  AgentMessageCompletedEvent,
  AgentModelStartedEvent,
  AgentToolCompletedEvent,
  AgentToolStartedEvent,
  AgentToolUpdatedEvent,
} from './agent-events.js'
export {Agent} from './agent.js'
export type {AgentInvokeOptions, AgentOptions, AgentTool} from './agent.js'
export {
  APP_NAME,
  configureApp,
  DOT_APP_DIR_NAME,
  ensureDir,
  getPaths,
  logsDir,
  sessionsDir,
  setAppName,
  SETTINGS_FILE_NAME,
} from './app.js'
export type {AppConfig} from './app.js'
export {guiSlashCommandHelpMessage, OrbitApplicationService} from './application.js'
export type {
  GuiPreferences,
  OrbitApplicationServiceOptions,
  RuntimeContextSource,
  RuntimeSettingsSource,
  RuntimeSnapshot,
  StartApplicationRunResult,
} from './application.js'
export {attachDiagnosticLogger, DiagnosticCapture, DiagnosticEventBus, DiagnosticLevel} from './diagnostics/index.js'
export type {
  DiagnosticContext,
  DiagnosticData,
  DiagnosticEvent,
  DiagnosticEventBusOptions,
  DiagnosticEventHandler,
  DiagnosticEventInput,
} from './diagnostics/index.js'
export {
  ContextOverflowError,
  InvalidConfigurationError,
  InvalidInputError,
  ModelAbortError,
  OperatorSequenceEmptyError,
  OrbitError,
  OrbitErrorCode,
} from './errors/index.js'
export type {OrbitErrorOptions} from './errors/index.js'
export * from './execution/index.js'
export {runInteractiveSession} from './interactive.js'
export type {
  InteractiveAgentClass,
  InteractiveSessionOptions,
  InteractiveState,
  ModelCommandResult,
} from './interactive.js'
export {createCompositeLogger, createLogger, createNoopLogger} from './logger/index.js'
export type {LogFields, Logger, LoggerBindings, LoggerOptions, LogLevel, LogMethod, LogValue} from './logger/index.js'
export {
  FileSessionLogStore,
  getLogContext,
  LogCategory,
  LogEventType,
  LogOutcome,
  MemorySessionLogStore,
  runWithLogContext,
  StoreSessionLoggerFactory,
} from './logs/index.js'
export type {
  FileSessionLogStoreOptions,
  LegacyLogRecord,
  LogCorrelation,
  LogPage,
  LogQuery,
  LogRecord,
  LogRecordHandler,
  LogStoreHealth,
  LogUsage,
  MemorySessionLogStoreOptions,
  SessionLoggerFactory,
  SessionLogStore,
  SessionLogStoreOptions,
  StoreSessionLoggerFactoryOptions,
} from './logs/index.js'
export {createMcpClient, createMcpToolManager, createMcpTransport, mcpToolName} from './mcp.js'
export type {
  McpClient,
  McpClientFactory,
  McpToolDefinition,
  McpToolManager,
  McpToolManagerFactoryOptions,
  McpToolManagerOptions,
  McpTransportFactory,
} from './mcp.js'
export {Message, MessageType, UserMessage} from './message/index.js'
export type {MessageOptions, MessagePayload} from './message/index.js'
export {DEFAULT_MODELS, getModel, getModelRegistry, ModelRegistry, registerModelProvider} from './models/factory.js'
export type {ModelProviderRegistration} from './models/factory.js'
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
} from './models/model.js'
export type {PreparedModelInvocation} from './models/model.js'
export type {Prompt} from './models/prompt.js'
export {splitSystemPrompt} from './models/prompt.js'
export type {Provider, ProviderName} from './models/provider.js'
export {createProvider, getProvider, getProviderNames, isProvider, isProviderName} from './models/provider.js'
export {getRoles, Role} from './models/role.js'
export {inspectGraphRun} from './processor/graph-inspection.js'
export type {GraphInspection, GraphTranscriptEvidence} from './processor/graph-inspection.js'
export {CompiledProcessorGraph, compileProcessorGraph, DEFAULT_GRAPH_PROFILE} from './processor/index.js'
export type {
  GraphAdapter,
  GraphDefinition,
  GraphDescriptor,
  GraphJSON,
  GraphNode,
  GraphProfile,
  GraphSnapshot,
  GraphValue,
} from './processor/index.js'
export {OperatorSequence, ProcessorRegistry} from './processor/index.js'
export {OperatorType} from './processor/index.js'
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
} from './processor/index.js'
export {
  createSessionInformation,
  encodeSessionEntry,
  formatSessionInformation,
  parseSessionFile,
  Session,
  SESSION_FORMAT_VERSION,
  SessionContextBuilder,
  SessionDeletionService,
  SessionEntryType,
  sessionFilePath,
  SessionHeader,
  SessionRecorder,
  SessionRepository,
  TurnPhase,
} from './session/index.js'
export type {
  AppendMessageOptions,
  CreateSessionOptions,
  FindLatestSessionOptions,
  ParsedSessionFile,
  PersistedMessage,
  RecordTurnContextOptions,
  RecordTurnEventOptions,
  SessionEntry,
  SessionError,
  SessionHeaderEntry,
  SessionHeaderOptions,
  SessionInformation,
  SessionInformationOverrides,
  SessionListError,
  SessionListOptions,
  SessionListResult,
  SessionMessageEntry,
  SessionMetadata,
  SessionModelContext,
  SessionOptions,
  SessionRepositoryOptions,
  SessionStatus,
  SessionSummary,
  SessionThreadCloser,
  SessionTurnContextEntry,
  SessionTurnEventEntry,
} from './session/index.js'
export {
  coordinationPaths,
  initializeSessionStorage,
  inspectSessionStorage,
  isSessionLocked,
  recoverSessionWriter,
  resumeSessionStorage,
  retrySessionCleanup,
} from './session/index.js'
export type {
  OfflineStorageConditions,
  RegistrationResumeOptions,
  SessionScope,
  SessionWriterLease,
  StorageRegistrationInspection,
} from './session/index.js'
export {
  ContextBudgetError,
  estimateJSONRequest,
  migrateSessionTranscript,
  validateContextProfile,
} from './session/index.js'
export type {
  ContextPolicy,
  ContextPreparationEvent,
  ContextProfile,
  ContextSummary,
  RequestEstimate,
  RequestEstimator,
  SessionCompactionEntry,
  SummaryFact,
  SummaryTest,
} from './session/index.js'
export {inspectTranscriptMigration} from './session/index.js'
export type {TranscriptMigrationInspection} from './session/index.js'
export {
  loadWorkspaceSettings,
  loadWorkspaceSettingsSync,
  loadWorkspaceSettingsWithSources,
  loadWorkspaceSettingsWithSourcesSync,
  mergeWorkspaceSettings,
} from './settings.js'

export type {
  McpServerSettings,
  McpSettings,
  ProviderConnectionSettings,
  ProviderSettings,
  ResolvedWorkspaceSettings,
  ToolSettings,
  WorkspaceSettings,
  WorkspaceSettingsSource,
} from './settings.js'

export * from './skills/index.js'
export {State} from './state.js'

export {serializeMessage, ThreadEventType, ThreadManager, ThreadStatus} from './thread.js'
export type {
  CreateThreadOptions,
  ThreadAgent,
  ThreadAgentFactory,
  ThreadError,
  ThreadEvent,
  ThreadEventHandler,
  ThreadManagerOptions,
  ThreadMessage,
  ThreadMessageCompletedEvent,
  ThreadModelStartedEvent,
  ThreadRunCancelledEvent,
  ThreadRunCompletedEvent,
  ThreadRunFailedEvent,
  ThreadRunHandle,
  ThreadRunOptions,
  ThreadRunStartedEvent,
  ThreadSnapshot,
  ThreadToolCompletedEvent,
  ThreadToolStartedEvent,
  ThreadToolUpdatedEvent,
} from './thread.js'
export {GptTokenizer} from './tokenizer/index.js'

export type {Tokenizer} from './tokenizer/index.js'
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
  tool,
  Tool,
  ToolProfile,
  ToolRegistry,
  ToolRuntime,
  ToolSnapshot,
} from './tools/index.js'

export type {
  BashToolInput,
  BuiltinToolSelection,
  EditToolInput,
  GlobToolInput,
  GrepToolInput,
  JsonSchema,
  ListToolInput,
  ModelToolSpec,
  ReadToolInput,
  ToolConfig,
  ToolContent,
  ToolContext,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandler,
  ToolInput,
  ToolInputCodec,
  ToolOptions,
  ToolOutput,
  ToolProfileName,
  ToolResult,
  ToolScheduling,
  ToolSource,
  WriteToolInput,
} from './tools/index.js'

export {LocalWorkspaceLocator} from './workspace.js'
export type {LocalWorkspaceLocatorOptions, WorkspaceLocator} from './workspace.js'
