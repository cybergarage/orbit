// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Box, render, Text, useApp, useInput} from 'ink'
import {useState} from 'react'

import {Agent, type AgentOptions, isProvider, type Prompt, type Provider} from './models/index.js'

export interface InteractiveSessionOptions {
  agentClass: InteractiveAgentClass
  initialModel: string
  initialProvider: Provider
  systemPrompt?: string
}

export interface InteractiveAgentClass {
  new (options?: AgentOptions): Agent
}

export interface InteractiveState {
  input: string
  isLoading: boolean
  messages: Prompt[]
  model: string
  provider: Provider
  systemPrompt?: string
}

export interface ModelCommandResult {
  message: string
  nextState: InteractiveState
}

export function createInitialInteractiveState(
  options: Pick<InteractiveState, 'model' | 'provider' | 'systemPrompt'>,
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

  const commandResult = handleModelCommand(state, input)
  if (commandResult) {
    return {
      ...commandResult.nextState,
      messages: [...state.messages, {content: commandResult.message, role: 'assistant'}],
    }
  }

  const requestMessages = [
    ...(state.systemPrompt ? [{content: state.systemPrompt, role: 'system'} as Prompt] : []),
    ...state.messages,
    {content: input, role: 'user'} as Prompt,
  ]
  const agent = new AgentClass({
    model: {
      name: state.model,
      provider: state.provider,
    },
  })
  const reply = await agent.prompt(requestMessages)

  return {
    ...state,
    messages: [...state.messages, {content: input, role: 'user'}, reply],
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

export function formatProviderModel(provider: Provider, model: string): string {
  return `${provider}:${model}`
}

function parseProvider(value: string): Provider | undefined {
  if (isProvider(value)) {
    return value
  }
}

function InteractiveApp({agentClass: AgentClass, initialModel, initialProvider, systemPrompt}: InteractiveSessionOptions) {
  const {exit} = useApp()
  const [state, setState] = useState<InteractiveState>(() =>
    createInitialInteractiveState({
      model: initialModel,
      provider: initialProvider,
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

      const commandResult = handleModelCommand(state, nextInput)
      if (commandResult) {
        setState({
          ...commandResult.nextState,
          input: '',
          isLoading: false,
          messages: [...state.messages, {content: commandResult.message, role: 'assistant'}],
        })
        return
      }

      const nextMessages = [...state.messages, {content: nextInput, role: 'user'} as Prompt]
      const requestMessages = [
        ...(state.systemPrompt ? [{content: state.systemPrompt, role: 'system'} as Prompt] : []),
        ...nextMessages,
      ]
      setState({
        ...state,
        input: '',
        isLoading: true,
        messages: nextMessages,
      })

      const agent = new AgentClass({
        model: {
          name: state.model,
          provider: state.provider,
        },
      })

      agent
        .prompt(requestMessages)
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
            messages: [...nextMessages, {content: message, role: 'assistant'}],
          }))
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
      <Text>Interactive mode. Press Ctrl+C or type /exit to leave.</Text>
      <Text dimColor>Current model: {formatProviderModel(state.provider, state.model)}</Text>
      <Box flexDirection="column" marginTop={1}>
        {state.messages.length === 0 ? <Text dimColor>No messages yet.</Text> : null}
        {state.messages.map((message, index) => (
          <Text key={`${message.role}-${index}`}>
            {message.role === 'user' ? 'You' : 'Assistant'}: {message.content}
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
