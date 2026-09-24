// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Args, Command, Flags} from '@oclif/core'
import {readFileSync} from 'node:fs'
import process from 'node:process'

import {type AgentOptions, resolveWorkspaceAgentOptions} from '../../core/chat.js'
import {loadSystemContexts} from '../../core/context.js'
import {Agent, Message, MessageType, Role, ToolProfile} from '../../core/index.js'
import {selectOllamaModel} from '../../core/models/adapters/ollama.js'
import {loadWorkspaceSettings} from '../../core/settings.js'
import {parseSkillSelection} from '../../core/skills/index.js'
import {confirmOperation} from '../approval.js'
import {agentFlags, toAgentOptions} from '../cli-flags.js'
import {productExtensions} from '../plugins.js'

type AgentClass = new (options?: ConstructorParameters<typeof Agent>[0]) => Agent

export async function runExecCommand(
  options: AgentOptions & {prompt?: string; skills?: string[]},
  stdin = process.stdin,
  cwd = process.cwd(),
  deps: {
    agentClass?: AgentClass
    contextLoader?: typeof loadSystemContexts
    ollamaModelSelector?: typeof selectOllamaModel
    settingsLoader?: typeof loadWorkspaceSettings
  } = {},
): Promise<string> {
  let {prompt} = options
  if (!prompt) {
    if (stdin.isTTY) {
      throw new Error('No prompt provided. Pass a prompt as an argument or via stdin.')
    }

    prompt = readFileSync(stdin.fd, 'utf8').trim()
  }

  const resolvedOptions = await resolveWorkspaceAgentOptions(
    options,
    cwd,
    deps.settingsLoader,
    deps.ollamaModelSelector,
  )
  const systemContexts = await (deps.contextLoader ?? loadSystemContexts)(cwd)
  const systemPrompts = systemContexts.filter((context) => context.content).map((context) => context.content)
  const systemMessages: Message[] = systemPrompts.map(
    (systemPrompt) => new Message(MessageType.Session, {content: systemPrompt, role: Role.System}),
  )

  const AgentClass = deps.agentClass ?? Agent
  const controller = new AbortController()
  const stop = () => controller.abort('user')
  const extensions = await productExtensions(cwd, options)
  const {skillCatalog} = extensions
  const agent = new AgentClass({
    ...(extensions.plugins ? {plugins: extensions.plugins} : {}),
    cwd,
    defaultToolProfile: ToolProfile.Coding,
    execution: {
      journalLevel: resolvedOptions.journalLevel,
      async onApproval(request) {
        const approve = await confirmOperation(request, controller.signal)
        await agent.replyApproval(request.runId, {
          approve,
          digest: request.digest,
          requestId: request.id,
          responderScope: 'local-cli',
        })
      },
      policy: {generation: 'product-v1', profile: resolvedOptions.executionPolicy ?? 'workspace-confirm', roots: [cwd]},
      responderScope: 'local-cli',
    },
    messages: systemMessages,
    model: {
      name: resolvedOptions.model,
      provider: resolvedOptions.provider,
    },
    settings: resolvedOptions.settings,
    ...(skillCatalog ? {skillCatalog} : {}),
  })
  if (resolvedOptions.settings.contextPolicy?.mode === 'budgeted') process.stderr.write('Context mode: budgeted\n')
  agent.logger.setDebugEnabled(resolvedOptions.debug === true)
  const userMessages: Message[] = [new Message(MessageType.User, {content: prompt, role: Role.User})]
  process.on('SIGINT', stop)
  try {
    if (options.skills?.length) await skillCatalog?.list(controller.signal)
    const response = await agent.invoke(userMessages, {
      onEvent(event) {
        if (event.type === 'context-prepared') process.stderr.write('Context preparation: ' + event.outcome + '\n')
      },
      signal: controller.signal,
      skills: options.skills?.map(parseSkillSelection),
    })
    return response.content
  } finally {
    try {
      await Promise.allSettled([agent.close(), skillCatalog?.settle()]).then((cleanup) => {
        const failure = cleanup.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
      })
    } finally {
      process.removeListener('SIGINT', stop)
    }
  }
}

export default class Exec extends Command {
  static args = {
    prompt: Args.string({
      description: 'Prompt to send to the agent',
      required: false,
    }),
  }
  static description = 'Send a prompt to the agent and print the response'
  static examples = [
    `<%= config.bin %> <%= command.id %> "Write a haiku about TypeScript"`,
    `echo "Write a haiku about TypeScript" | <%= config.bin %> <%= command.id %>`,
  ]
  static flags = {
    ...agentFlags,
    skill: Flags.string({description: 'Select Skill ID@DIGEST for this Run (repeatable)', multiple: true}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Exec)
    try {
      const response = await runExecCommand({...toAgentOptions(flags), prompt: args.prompt, skills: flags.skill})
      this.log(response)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Exec command failed.')
    }
  }
}
