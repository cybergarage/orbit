// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Box, render, Text, useApp, useInput} from 'ink'
import process from 'node:process'
import {useEffect, useRef, useState} from 'react'

import type {ApprovalRequest} from './execution/run.js'
import type {Logger} from './logger/index.js'
import type {SessionRepository} from './session/index.js'
import type {WorkspaceSettings} from './settings.js'
import type {SkillCatalog, SkillSelection} from './skills/index.js'

import {RunExecutionError} from './execution/run.js'
import {FileSessionLogStore, StoreSessionLoggerFactory} from './logs/index.js'
import {Agent, type AgentOptions, isProvider, Message, MessageType, type ProviderName, Role} from './models/index.js'
import {
  SessionRepository as CoreSessionRepository,
  createSessionInformation,
  formatSessionInformation,
  Session,
} from './session/index.js'
import {parseSkillSelection} from './skills/index.js'
import {State} from './state.js'
import {ToolProfile} from './tools/index.js'
import {formatToolInventory, inspectTools, type ToolInventoryOptions} from './tools/inventory.js'

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
  plugins?: import('./plugins/index.js').LoadedPlugins
  session?: Session
  sessionRepository?: SessionRepository
  settings?: WorkspaceSettings
  skillCatalog?: SkillCatalog
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
  pendingSkills?: SkillSelection[]
  plugins?: import('./plugins/index.js').LoadedPlugins
  provider: ProviderName
  session?: Session
  settings?: WorkspaceSettings
  skillCatalog?: SkillCatalog
  systemPrompt?: string
}

export interface ModelCommandResult {
  message: string
  nextState: InteractiveState
}

export type SlashCommandResult = ModelCommandResult

const slashCommandHelpItems = [
  {command: '/tools [--connect]', description: 'List tool metadata; optionally discover MCP tools'},
  {command: '/mcp [--connect]', description: 'List MCP servers; optionally connect to count tools'},
  {command: '/skills', description: 'List Skill IDs and digests'},
  {command: '/skill ID@DIGEST', description: 'Select for the next Run; /skill clear removes pending selections'},
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
    | 'plugins'
    | 'provider'
    | 'session'
    | 'settings'
    | 'skillCatalog'
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

export async function handleSkillCommand(
  state: InteractiveState,
  input: string,
  signal?: AbortSignal,
): Promise<SlashCommandResult | undefined> {
  if (input !== '/skills' && !input.startsWith('/skill ')) return
  if (input === '/skill clear')
    return {message: 'Pending Skill selections cleared', nextState: {...state, pendingSkills: []}}
  if (!state.skillCatalog) return {message: 'No Skill catalog configured', nextState: state}
  if (input === '/skills') {
    const list = await state.skillCatalog.list(signal)
    return {
      message:
        [
          ...list.candidates.map(
            (c) =>
              `${c.id}@${c.digest} ${JSON.stringify(c.name)} ${JSON.stringify(c.file)} ${JSON.stringify(c.description)}${c.license === undefined ? '' : ` license=${JSON.stringify(c.license)}`}${c.compatibility === undefined ? '' : ` compatibility=${JSON.stringify(c.compatibility)}`}`,
          ),
          ...list.issues.map((issue) => JSON.stringify(issue)),
        ].join('\n') || 'No Skills found',
      nextState: state,
    }
  }

  const selection = parseSkillSelection(input.slice(7).trim())
  const pendingSkills = [...(state.pendingSkills ?? []).filter((item) => item.id !== selection.id), selection]
  return {
    message: `Pending Skill: ${selection.id}. Resolution happens after Run admission.`,
    nextState: {...state, pendingSkills},
  }
}

export async function handleInventoryCommand(
  state: InteractiveState,
  input: string,
  options: Pick<ToolInventoryOptions, 'approve' | 'signal'> = {},
): Promise<SlashCommandResult | undefined> {
  const [command, ...args] = input.split(/\s+/u)
  if (command !== '/tools' && command !== '/mcp') return
  if (args.length > 1 || (args.length === 1 && args[0] !== '--connect'))
    return {message: `Invalid inventory command. Use ${command} [--connect]`, nextState: state}
  const inventory = await inspectTools({
    ...options,
    connect: args[0] === '--connect',
    cwd: state.cwd,
    executionPolicy: state.executionPolicy,
    settings: state.settings,
  })
  return {message: formatToolInventory(inventory, command === '/tools' ? 'tools' : 'mcp'), nextState: state}
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

  const commandResult =
    (await handleInventoryCommand(state, input)) ??
    (await handleSkillCommand(state, input)) ??
    handleSlashCommand(state, input)
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
    plugins: state.plugins,
    settings: state.settings,
    skillCatalog: state.skillCatalog,
    state: new State(session),
  })
  let reply: Message
  try {
    reply = await agent.invoke([userMessage], {
      onEvent(event) {
        if (event.type === 'context-prepared')
          state.logger?.info({eventType: 'context.prepared', ...event}, 'Context preparation finished')
      },
      onRunAdmitted() {
        state = {...state, pendingSkills: []}
      },
      skills: state.pendingSkills,
    })
  } catch (error) {
    return {
      ...state,
      conversationMessages: session.getConversationMessages(),
      isLoading: error instanceof RunExecutionError && !error.result.quiescence,
      messages: [
        ...state.messages,
        userMessage,
        new Message(MessageType.Assistant, {
          content: error instanceof Error ? error.message : 'Interactive request failed',
        }),
      ],
    }
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

/**
 * Normalizes typed or pasted interactive input before it is appended to the prompt buffer.
 * Terminals send pasted line breaks as carriage returns, which would move the cursor to the
 * start of the line when rendered and overwrite earlier text.
 */
export function normalizeInteractiveInput(value: string): string {
  return value.replaceAll(/\r\n?/gu, '\n')
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
  plugins,
  session,
  settings,
  skillCatalog,
  systemPrompt,
}: InteractiveSessionOptions) {
  const {exit} = useApp()
  const active = useRef<undefined | {agent: Agent; controller: AbortController}>(undefined)
  const listing = useRef<AbortController | undefined>(undefined)
  const listingApproval = useRef<((approved: boolean) => void) | undefined>(undefined)
  useEffect(
    () => () => {
      listing.current?.abort()
    },
    [],
  )
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
      plugins,
      provider: initialProvider,
      skillCatalog,
      ...(session === undefined ? {} : {session}),
      settings,
      systemPrompt,
    }),
  )

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      if (listing.current) {
        listing.current.abort()
        listingApproval.current?.(false)
        setApproval(undefined)
        return
      }

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
        if (listingApproval.current) {
          listingApproval.current(value.toLowerCase() === 'y')
          return
        }

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

      if (nextInput === '/skills' || nextInput.startsWith('/skill ') || /^\/(?:tools|mcp)(?:\s|$)/u.test(nextInput)) {
        const controller = new AbortController()
        listing.current = controller
        setState({...state, input: '', isLoading: true})
        const inspect = async () =>
          (await handleInventoryCommand(state, nextInput, {
            approve: (request) =>
              new Promise<boolean>((resolve) => {
                const finish = (approved: boolean) => {
                  clearTimeout(timer)
                  controller.signal.removeEventListener('abort', cancel)
                  listingApproval.current = undefined
                  setApproval(undefined)
                  resolve(approved)
                }

                const cancel = () => finish(false)
                const timer = setTimeout(cancel, Math.max(0, request.expiresAt - Date.now()))
                if (controller.signal.aborted) {
                  finish(false)
                  return
                }

                controller.signal.addEventListener('abort', cancel, {once: true})
                listingApproval.current = finish
                setApproval(request)
              }),
            signal: controller.signal,
          })) ?? handleSkillCommand(state, nextInput, controller.signal)
        inspect()
          .then((result) => {
            if (result)
              setState({
                ...result.nextState,
                input: '',
                isLoading: false,
                messages: [...state.messages, new Message(MessageType.Assistant, {content: result.message})],
              })
          })
          .catch((error) => {
            if (error instanceof RunExecutionError && !error.result.quiescence) setBlocked(true)
            setState({
              ...state,
              input: '',
              isLoading: false,
              messages: [...state.messages, new Message(MessageType.Assistant, {content: String(error)})],
            })
          })
          .finally(() => {
            listing.current = undefined
          })
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
        plugins: state.plugins,
        settings: state.settings,
        skillCatalog: state.skillCatalog,
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
          onRunAdmitted() {
            setState((current) => ({...current, pendingSkills: []}))
            setContextNotice(state.pendingSkills?.length ? 'Skill selection admitted; resolving before model use' : '')
          },
          onRunSnapshot(snapshot) {
            setApproval(snapshot.approvals[0])
            if (snapshot.skills)
              setContextNotice(
                `${snapshot.result ? 'Finished' : snapshot.skills.resolved ? 'Resolved' : 'Loading'} Skills: ${snapshot.skills.requested.length}`,
              )
          },
          signal: controller.signal,
          skills: state.pendingSkills,
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
    const normalized = normalizeInteractiveInput(value)
    setState((currentState) => ({...currentState, input: currentState.input + normalized}))
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
      formatVersion:
        options.settings?.interruptionPolicy?.mode === 'verified-not-dispatched'
          ? 3
          : options.skillCatalog || options.settings?.contextPolicy?.mode === 'budgeted'
            ? 2
            : 1,
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
    await options.skillCatalog?.settle()
    await Promise.all([...agents].map((agent) => agent.close()))
    if (options.session === undefined) await session.close()
    await ownedLogStore?.close()
  }
}
