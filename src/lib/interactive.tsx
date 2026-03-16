// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Box, render, Text, useApp, useInput} from 'ink'
import {useState} from 'react'

import type {Agent, ChatMessage} from './agent.js'

export interface InteractiveSessionOptions {
  agent: Agent
}

export interface InteractiveState {
  input: string
  isLoading: boolean
  messages: ChatMessage[]
}

export function createInitialInteractiveState(): InteractiveState {
  return {
    input: '',
    isLoading: false,
    messages: [],
  }
}

export async function submitInteractiveInput(
  agent: Agent,
  state: InteractiveState,
  rawInput: string,
): Promise<InteractiveState> {
  const input = rawInput.trim()
  if (!input || state.isLoading || input === '/exit') {
    return state
  }

  const requestMessages = [...state.messages, {content: input, role: 'user'} as ChatMessage]
  const reply = await agent.chat(requestMessages)

  return {
    input: '',
    isLoading: false,
    messages: [...requestMessages, {content: reply, role: 'assistant'}],
  }
}

function InteractiveApp({agent}: InteractiveSessionOptions) {
  const {exit} = useApp()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      exit()
      return
    }

    if (key.return) {
      const nextInput = input.trim()
      if (!nextInput || isLoading) return
      if (nextInput === '/exit') {
        exit()
        return
      }

      const nextMessages = [...messages, {content: nextInput, role: 'user'} as ChatMessage]
      setMessages(nextMessages)
      setInput('')
      setIsLoading(true)

      agent
        .chat(nextMessages)
        .then((reply) => {
          setMessages([...nextMessages, {content: reply, role: 'assistant'}])
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Interactive request failed.'
          setMessages([...nextMessages, {content: message, role: 'assistant'}])
        })
        .finally(() => {
          setIsLoading(false)
        })
      return
    }

    if (key.backspace || key.delete) {
      setInput(input.slice(0, -1))
      return
    }

    if (key.escape) return
    setInput(input + value)
  })

  return (
    <Box flexDirection="column">
      <Text>Interactive mode. Press Ctrl+C or type /exit to leave.</Text>
      <Box flexDirection="column" marginTop={1}>
        {messages.length === 0 ? <Text dimColor>No messages yet.</Text> : null}
        {messages.map((message, index) => (
          <Text key={`${message.role}-${index}`}>
            {message.role === 'user' ? 'You' : 'Assistant'}: {message.content}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="cyan">{'> '}</Text>
        <Text>{input}</Text>
        {isLoading ? null : <Text backgroundColor="white" color="black"> </Text>}
      </Box>
      {isLoading ? (
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
