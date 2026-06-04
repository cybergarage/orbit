// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Box, render, Text, useApp, useInput} from 'ink'
import {useState} from 'react'

import type {Logger} from './logger/index.js'
import type {WorkspaceSettings} from './settings.js'

import {Agent, type AgentOptions, isProvider, Message, MessageType, type ProviderName, Role} from './models/index.js'

export interface InteractiveSessionOptions {
  agentClass: InteractiveAgentClass
  initialModel: string
  initialProvider: ProviderName
  logger?: Logger
  settings?: WorkspaceSettings
  systemPrompt?: string
}

export interface InteractiveAgentClass {
  new (options?: AgentOptions): Agent
}

export interface InteractiveState {
  input: string
  isLoading: boolean
  logger?: Logger
  messages: Message[]
  model: string
  provider: ProviderName
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
  options: Pick<InteractiveState, 'logger' | 'model' | 'provider' | 'settings' | 'systemPrompt'>,
): InteractiveState {
  return {
    input: '',
    isLoading: false,
    messages: [],
    ...options,
  }
}

export async function submitInteractiveInput(
  AgentClass: InteractiveAgentClass,
  state: InteractiveState,
  rawInput: string,
): Promise<InteractiveState> {
  const input = rawInput.trim()
  if (!input || state.isLoading || input === '/exit') {
    return state
  }

  const commandResult = handleSlashCommand(state, input)
  if (commandResult) {
    return {
      ...commandResult.nextState,
      messages: [...state.messages, new Message(MessageType.Assistant, {content: commandResult.message})],
    }
  }

  const userMessage = new Message(MessageType.User, {content: input, role: Role.User})
  const requestMessages = [
    ...(state.systemPrompt ? [new Message(MessageType.Session, {content: state.systemPrompt, role: Role.System})] : []),
    ...state.messages,
    userMessage,
  ]
  const agent = new AgentClass({
    logger: state.logger,
    model: {
      name: state.model,
      provider: state.provider,
    },
    settings: state.settings,
  })
  let reply: Message
  try {
    reply = await agent.invoke(requestMessages)
  } finally {
    await agent.close()
  }

  return {
    ...state,
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
  initialModel,
  initialProvider,
  logger,
  settings,
  systemPrompt,
}: InteractiveSessionOptions) {
  const {exit} = useApp()
  const [state, setState] = useState<InteractiveState>(() =>
    createInitialInteractiveState({
      logger,
      model: initialModel,
      provider: initialProvider,
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
      const requestMessages = [
        ...(state.systemPrompt ? [new Message(MessageType.Session, {content: state.systemPrompt, role: Role.System})] : []),
        ...nextMessages,
      ]
      setState({
        ...state,
        input: '',
        isLoading: true,
        messages: nextMessages,
      })

      const agent = new AgentClass({
        logger: state.logger,
        model: {
          name: state.model,
          provider: state.provider,
        },
        settings: state.settings,
      })

      agent
        .invoke(requestMessages)
        .then((reply) => {
          setState((currentState) => ({
            ...currentState,
            isLoading: false,
            messages: [...nextMessages, reply],
          }))
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Interactive request failed.'
          setState((currentState) => ({
            ...currentState,
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
        {state.isLoading ? null : <Text backgroundColor="white" color="black"> </Text>}
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
  const app = render(<InteractiveApp {...options} />)
  await app.waitUntilExit()
}
