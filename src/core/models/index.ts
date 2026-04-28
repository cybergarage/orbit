// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export {Agent} from '../agent.js'
export type {AgentOptions} from '../agent.js'
export {PromptTemplate} from '../prompts/template.js'
export type {PromptTemplateInput} from '../prompts/template.js'
export {Message, MessageType, Session, SessionHeader} from '../session/index.js'
export type {
  AppendMessageOptions,
  MessageOptions,
  MessagePayload,
  SessionHeaderOptions,
  SessionOptions,
} from '../session/index.js'
export {DEFAULT_MODELS, getModel} from './factory.js'
export type {Model} from './model.js'
export type {Prompt} from './prompt.js'
export {splitSystemPrompt} from './prompt.js'
export type {Provider} from './provider.js'
export {getProvider, isProvider} from './provider.js'
export {getRoles, Role} from './role.js'
