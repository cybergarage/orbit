// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Box, render, Text, useApp, useInput} from 'ink'
import process from 'node:process'
import {useRef, useState} from 'react'

import type {ApprovalRequest} from './execution/run.js'
import type {Logger} from './logger/index.js'
import type {SessionRepository} from './session/index.js'
import type {WorkspaceSettings} from './settings.js'

import {RunExecutionError} from './execution/run.js'
import {FileSessionLogStore, StoreSessionLoggerFactory} from './logs/index.js'
import {Agent, type AgentOptions, isProvider, Message, MessageType, type ProviderName, Role} from './models/index.js'
import {
  SessionRepository as CoreSessionRepository,
  createSessionInformation,
  formatSessionInformation,
  Session,
} from './session/index.js'
import {State} from './state.js'
import {ToolProfile} from './tools/index.js'

export interface InteractiveSessionOptions {
  agentClass: InteractiveAgentClass
  cwd?: string
  debug?: boolean
  executionPolicy?: 'unrestricted' | 'workspace-confirm'
  initialModel: string
  initialProvider: ProviderName
  journalLevel?: 'file-and-directory-sync' | 'file-sync'
  logger?: Logger
  onAgentCreated?: (agent: Agent) => void
  session?: Session
  sessionRepository?: SessionRepository
  settings?: WorkspaceSettings
  systemPrompt?: string
}

export interface InteractiveAgentClass {
  new (options?: AgentOptions): Agent
}

export interface InteractiveState {
  conversationMessages: Message[]
  cwd?: string
  executionPolicy?: 'unrestricted' | 'workspace-confirm'
  input: string
  isLoading: boolean
  journalLevel?: 'file-and-directory-sync' | 'file-sync'
  logger?: Logger
  messages: Message[]
  model: string
  provider: ProviderName
  session?: Session
  settings?: WorkspaceSettings
  systemPrompt?: string
}

export interface ModelCommandResult {
  message: string
  nextState: InteractiveState
}

export type SlashCommandResult = ModelCommandResult

const slashCommandHelpItems = [
  {command: '/help', description: 'Show slash commands'},
  {command: '/exit', description: 'Exit interactive mode'},
  {command: '/session', description: 'Show the current session information'},
  {command: '/model', description: 'Show the current model'},
  {command: '/model provider:model', description: 'Switch the current model'},
  {command: '/debug', description: 'Show debug logging state'},
  {command: '/debug on', description: 'Enable debug logging'},
  {command: '/debug off', description: 'Disable debug logging'},
]

export const slashCommandHelpMessage = [
  'Slash commands:',
  ...slashCommandHelpItems.map((item) => `${item.command} - ${item.description}`),
].join('\n')

export function createInitialInteractiveState(
  options: Pick<
    InteractiveState,
    | 'cwd'
    | 'executionPolicy'
    | 'journalLevel'
    | 'logger'
    | 'model'
    | 'provider'
    | 'session'
    | 'settings'
    | 'systemPrompt'
  >,
): InteractiveState {
  const conversationMessages = options.session?.getConversationMessages() ?? []
  return {
    conversationMessages,
    input: '',
    isLoading: false,
    messages: conversationMessages.filter(
      (message) => message.type === MessageType.User || message.type === MessageType.Assistant,
    ),
    ...options,
  }
}

export async function submitInteractiveInput(
  AgentClass: InteractiveAgentClass,
  state: InteractiveState,
  rawInput: string,
): Promise<InteractiveState> {
  const input = rawInput.trim()
  if (!input || state.isLoading) {
    return state
  }

  if (input.startsWith('/')) state.logger?.info({command: input}, 'interactive command submitted')
  if (input === '/exit') return state

  const commandResult = handleSlashCommand(state, input)
  if (commandResult) {
    return {
      ...commandResult.nextState,
      messages: [...state.messages, new Message(MessageType.Assistant, {content: commandResult.message})],
    }
  }

  const userMessage = new Message(MessageType.User, {content: input, role: Role.User})
  const systemMessages = state.systemPrompt
    ? [new Message(MessageType.Session, {content: state.systemPrompt, role: Role.System})]
    : []
  const session = state.session ?? new Session({messages: state.conversationMessages})
  const agent = new AgentClass({
    cwd: state.cwd,
    defaultToolProfile: ToolProfile.Coding,
    execution: {
      journalLevel: state.journalLevel,
      policy: {
        generation: 'product-v1',
        profile: state.executionPolicy ?? 'workspace-confirm',
        roots: [state.cwd ?? process.cwd()],
      },
    },
    logger: state.logger,
    messages: systemMessages,
    model: {
      name: state.model,
      provider: state.provider,
    },
    settings: state.settings,
    state: new State(session),
  })
  let reply: Message
  try {
    reply = await agent.invoke([userMessage], {
      onEvent(event) {
        if (event.type === 'context-prepared')
          state.logger?.info({eventType: 'context.prepared', ...event}, 'Context preparation finished')
      },
    })
  } finally {
    await agent.close()
  }

  return {
    ...state,
    conversationMessages: [...state.conversationMessages, userMessage, reply],
    messages: [...state.messages, userMessage, reply],
  }
}

export function handleModelCommand(state: InteractiveState, input: string): ModelCommandResult | undefined {
  if (!input.startsWith('/model')) return undefined

  if (input === '/model') {
    return {
      message: `Current model: ${formatProviderModel(state.provider, state.model)}`,
      nextState: state,
    }
  }

  const match = input.match(/^\/model\s+([^:\s]+):(.*)$/)
  if (!match) {
    return {
      message: 'Invalid model command. Use /model provider:model',
      nextState: state,
    }
  }

  const [, providerValue, modelValue] = match
  const provider = parseProvider(providerValue)
  if (!provider) {
    return {
      message: 'Invalid provider. Use anthropic, ollama, or openai',
      nextState: state,
    }
  }

  const model = modelValue.trim()
  if (!model) {
    return {
      message: 'Invalid model command. Model cannot be empty',
      nextState: state,
    }
  }

  return {
    message: `Model switched to ${formatProviderModel(provider, model)}`,
    nextState: {
      ...state,
      model,
      provider,
    },
  }
}

export function handleSlashCommand(state: InteractiveState, input: string): SlashCommandResult | undefined {
  if (!input.startsWith('/')) return undefined

  const [commandName] = input.split(/\s+/u)
  if (commandName === '/help') {
    return {
      message: slashCommandHelpMessage,
      nextState: state,
    }
  }

  if (commandName === '/model') {
    return handleModelCommand(state, input)
  }

  if (commandName === '/session') {
    if (input !== '/session') {
      return {
        message: 'Invalid session command. Use /session',
        nextState: state,
      }
    }

    if (state.session === undefined) {
      return {
        message: 'Session information is unavailable.',
        nextState: state,
      }
    }

    return {
      message: formatSessionInformation(
        createSessionInformation(state.session, {model: state.model, provider: state.provider}),
      ),
      nextState: state,
    }
  }

  if (commandName === '/debug') {
    return handleDebugCommand(state, input)
  }

  return {
    message: `Unknown command: ${commandName}`,
    nextState: state,
  }
}

function handleDebugCommand(state: InteractiveState, input: string): SlashCommandResult {
  const args = input.split(/\s+/u).slice(1)
  if (args.length === 0) {
    return {
      message: `Debug logging is ${state.logger?.isDebugEnabled() ? 'on' : 'off'}`,
      nextState: state,
    }
  }

  if (args.length === 1 && args[0] === 'on') {
    state.logger?.setDebugEnabled(true)
    return {
      message: 'Debug logging enabled',
      nextState: state,
    }
  }

  if (args.length === 1 && args[0] === 'off') {
    state.logger?.setDebugEnabled(false)
    return {
      message: 'Debug logging disabled',
      nextState: state,
    }
  }

  return {
    message: 'Invalid debug command. Use /debug, /debug on, or /debug off',
    nextState: state,
  }
}

export function formatProviderModel(provider: ProviderName, model: string): string {
  return `${provider}:${model}`
}

function parseProvider(value: string): ProviderName | undefined {
  if (isProvider(value)) {
    return value
  }
}

function InteractiveApp({
  agentClass: AgentClass,
  cwd,
  executionPolicy,
  initialModel,
  initialProvider,
  journalLevel,
  logger,
  onAgentCreated,
  session,
  settings,
  systemPrompt,
}: InteractiveSessionOptions) {
  const {exit} = useApp()
  const active = useRef<undefined | {agent: Agent; controller: AbortController}>(undefined)
  const [contextNotice, setContextNotice] = useState('')
  const [approval, setApproval] = useState<ApprovalRequest | undefined>()
  const [blocked, setBlocked] = useState(false)
  const [state, setState] = useState<InteractiveState>(() =>
    createInitialInteractiveState({
      cwd,
      executionPolicy,
      journalLevel,
      logger,
      model: initialModel,
      provider: initialProvider,
      ...(session === undefined ? {} : {session}),
      settings,
      systemPrompt,
    }),
  )

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      if (active.current) {
        active.current.controller.abort('user')
        setApproval(undefined)
      } else exit()
      return
    }

    if (approval) {
      if (value.toLowerCase() === 'y' || value.toLowerCase() === 'n') {
        const request = approval
        setApproval(undefined)
        active.current?.agent
          .replyApproval(request.runId, {
            approve: value.toLowerCase() === 'y',
            digest: request.digest,
            requestId: request.id,
            responderScope: 'local-interactive',
          })
          .catch((error) =>
            setState((current) => ({
              ...current,
              messages: [...current.messages, new Message(MessageType.Assistant, {content: String(error)})],
            })),
          )
      }

      return
    }

    if (key.return) {
      const nextInput = state.input.trim()
      if (!nextInput || state.isLoading || blocked) return
      if (nextInput.startsWith('/')) state.logger?.info({command: nextInput}, 'interactive command submitted')
      if (nextInput === '/exit') {
        exit()
        return
      }

      const commandResult = handleSlashCommand(state, nextInput)
      if (commandResult) {
        setState({
          ...commandResult.nextState,
          input: '',
          isLoading: false,
          messages: [...state.messages, new Message(MessageType.Assistant, {content: commandResult.message})],
        })
        return
      }

      const nextMessages = [...state.messages, new Message(MessageType.User, {content: nextInput, role: Role.User})]
      const systemMessages = state.systemPrompt
        ? [new Message(MessageType.Session, {content: state.systemPrompt, role: Role.System})]
        : []
      const userMessage = nextMessages.at(-1) as Message
      const session = state.session ?? new Session({messages: state.conversationMessages})
      setState({
        ...state,
        input: '',
        isLoading: true,
        messages: nextMessages,
      })

      const controller = new AbortController()
      const agent = new AgentClass({
        cwd: state.cwd,
        defaultToolProfile: ToolProfile.Coding,
        execution: {
          journalLevel: state.journalLevel,
          onApproval(request) {
            setApproval(request)
          },
          policy: {
            generation: 'product-v1',
            profile: state.executionPolicy ?? 'workspace-confirm',
            roots: [state.cwd ?? process.cwd()],
          },
          responderScope: 'local-interactive',
        },
        logger: state.logger,
        messages: systemMessages,
        model: {
          name: state.model,
          provider: state.provider,
        },
        settings: state.settings,
        state: new State(session),
      })

      active.current = {agent, controller}
      onAgentCreated?.(agent)
      agent
        .invoke([userMessage], {
          onEvent(event) {
            if (event.type === 'context-prepared')
              setContextNotice(
                event.outcome === 'compacted'
                  ? 'Conversation compacted'
                  : 'Compaction failed; original context retained',
              )
          },
          onRunSnapshot: (snapshot) => setApproval(snapshot.approvals[0]),
          signal: controller.signal,
        })
        .then((reply) => {
          setState((currentState) => ({
            ...currentState,
            conversationMessages: [...currentState.conversationMessages, nextMessages.at(-1) as Message, reply],
            isLoading: true,
            messages: [...nextMessages, reply],
          }))
        })
        .catch((error: unknown) => {
          if (error instanceof RunExecutionError && !error.result.quiescence) setBlocked(true)
          const message =
            error instanceof RunExecutionError
              ? `${error.result.outcome}; recording=${error.result.recording.status}; ${error.message}`
              : error instanceof Error
                ? error.message
                : 'Interactive request failed.'
          setState((currentState) => ({
            ...currentState,
            conversationMessages: [...currentState.conversationMessages, nextMessages.at(-1) as Message],
            isLoading: true,
            messages: [...nextMessages, new Message(MessageType.Assistant, {content: message})],
          }))
        })
        .finally(async () => {
          try {
            await agent.close()
          } catch (error) {
            setBlocked(true)
            setState((current) => ({
              ...current,
              messages: [...current.messages, new Message(MessageType.Assistant, {content: String(error)})],
            }))
          } finally {
            active.current = undefined
            setApproval(undefined)
            setState((current) => ({...current, isLoading: false}))
          }
        })
      return
    }

    if (key.backspace || key.delete) {
      setState((currentState) => ({...currentState, input: currentState.input.slice(0, -1)}))
      return
    }

    if (key.escape) return
    setState((currentState) => ({...currentState, input: currentState.input + value}))
  })

  return (
    <Box flexDirection="column">
      {contextNotice ? <Text dimColor>{contextNotice}</Text> : null}
      <Text>Interactive mode. Press Ctrl+C or type /exit to leave.</Text>
      {approval ? (
        <Text color="yellow">
          {JSON.stringify(approval.preview, null, 2)}
          {'\n'}Approve once? [y/n] Expires {new Date(approval.expiresAt).toISOString()}
        </Text>
      ) : null}
      {blocked ? (
        <Text color="red">Execution resources remain quarantined. Query the run before reusing this session.</Text>
      ) : null}
      <Text dimColor>
        Current model: {formatProviderModel(state.provider, state.model)} · Context:{' '}
        {state.settings?.contextPolicy?.mode ?? 'disabled'}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {state.messages.length === 0 ? <Text dimColor>No messages yet.</Text> : null}
        {state.messages.map((message, index) => (
          <Text key={`${message.role}-${index}`}>
            {message.role === Role.User ? 'You' : 'Assistant'}: {message.content}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="cyan">{'> '}</Text>
        <Text>{state.input}</Text>
        {state.isLoading ? null : (
          <Text backgroundColor="white" color="black">
            {' '}
          </Text>
        )}
      </Box>
      {state.isLoading ? (
        <Box marginTop={1}>
          <Text color="yellow">Thinking...</Text>
        </Box>
      ) : null}
    </Box>
  )
}

export async function runInteractiveSession(options: InteractiveSessionOptions): Promise<void> {
  const repository = options.sessionRepository ?? new CoreSessionRepository()
  const session =
    options.session ??
    repository.create({
      cwd: options.cwd,
      formatVersion: options.settings?.contextPolicy?.mode === 'budgeted' ? 2 : 1,
      model: options.initialModel,
      originator: 'orbit-interactive',
      provider: options.initialProvider,
      systemPrompt: options.systemPrompt,
    })
  const effectiveSystemPrompt = options.systemPrompt ?? session.getMetadata().systemPrompt
  let ownedLogStore: FileSessionLogStore | undefined
  let {logger} = options
  if (logger === undefined) {
    ownedLogStore = new FileSessionLogStore()
    logger = new StoreSessionLoggerFactory(ownedLogStore).forSession(session.getId())
  }

  if (options.debug !== undefined) logger.setDebugEnabled(options.debug)
  const agents = new Set<Agent>()
  const app = render(
    <InteractiveApp
      {...options}
      logger={logger}
      onAgentCreated={(agent) => {
        agents.add(agent)
      }}
      session={session}
      systemPrompt={effectiveSystemPrompt}
    />,
    {exitOnCtrlC: false},
  )
  try {
    await app.waitUntilExit()
  } finally {
    await Promise.all([...agents].map((agent) => agent.close()))
    if (options.session === undefined) await session.close()
    await ownedLogStore?.close()
  }
}
