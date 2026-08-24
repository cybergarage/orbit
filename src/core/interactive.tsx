// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Box, render, Text, useApp, useInput} from 'ink'
import {useState} from 'react'

import type {Logger} from './logger/index.js'
import type {SessionRepository} from './session/index.js'
import type {WorkspaceSettings} from './settings.js'

import {FileSessionLogStore, StoreSessionLoggerFactory} from './logs/index.js'
import {Agent, type AgentOptions, isProvider, Message, MessageType, type ProviderName, Role} from './models/index.js'
import {SessionRepository as CoreSessionRepository, Session} from './session/index.js'
import {State} from './state.js'
import {ToolProfile} from './tools/index.js'

export interface InteractiveSessionOptions {
  agentClass: InteractiveAgentClass
  cwd?: string
  debug?: boolean
  initialModel: string
  initialProvider: ProviderName
  logger?: Logger
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
  input: string
  isLoading: boolean
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
  options: Pick<InteractiveState, 'cwd' | 'logger' | 'model' | 'provider' | 'session' | 'settings' | 'systemPrompt'>,
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
    reply = await agent.invoke([userMessage])
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
  initialModel,
  initialProvider,
  logger,
  session,
  settings,
  systemPrompt,
}: InteractiveSessionOptions) {
  const {exit} = useApp()
  const [state, setState] = useState<InteractiveState>(() =>
    createInitialInteractiveState({
      cwd,
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
      exit()
      return
    }

    if (key.return) {
      const nextInput = state.input.trim()
      if (!nextInput || state.isLoading) return
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

      const agent = new AgentClass({
        cwd: state.cwd,
        defaultToolProfile: ToolProfile.Coding,
        logger: state.logger,
        messages: systemMessages,
        model: {
          name: state.model,
          provider: state.provider,
        },
        settings: state.settings,
        state: new State(session),
      })

      agent
        .invoke([userMessage])
        .then((reply) => {
          setState((currentState) => ({
            ...currentState,
            conversationMessages: [...currentState.conversationMessages, nextMessages.at(-1) as Message, reply],
            isLoading: false,
            messages: [...nextMessages, reply],
          }))
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Interactive request failed.'
          setState((currentState) => ({
            ...currentState,
            conversationMessages: [...currentState.conversationMessages, nextMessages.at(-1) as Message],
            isLoading: false,
            messages: [...nextMessages, new Message(MessageType.Assistant, {content: message})],
          }))
        })
        .finally(() => agent.close().catch(() => {}))
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
      <Text>Interactive mode. Press Ctrl+C or type /exit to leave.</Text>
      <Text dimColor>Current model: {formatProviderModel(state.provider, state.model)}</Text>
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
  const app = render(
    <InteractiveApp {...options} logger={logger} session={session} systemPrompt={effectiveSystemPrompt} />,
  )
  try {
    await app.waitUntilExit()
  } finally {
    if (options.session === undefined) await session.close()
    await ownedLogStore?.close()
  }
}
