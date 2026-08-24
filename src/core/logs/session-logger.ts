// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {v7 as uuidv7} from 'uuid'

import type {LogFields, Logger, LoggerBindings, LogLevel, LogMethod, LogValue} from '../logger/index.js'
import type {SessionLogStore} from './store.js'

import {reportLogStoreError} from './store.js'

const LEVEL_VALUES: Record<LogLevel, number> = {debug: 20, error: 50, fatal: 60, info: 30, trace: 10, warn: 40}

export interface SessionLoggerFactory {
  forApplication(bindings?: LoggerBindings): Logger
  forSession(sessionId: string, bindings?: LoggerBindings): Logger
}

export interface StoreSessionLoggerFactoryOptions {
  level?: LogLevel
  onError?: (error: Error) => void
}

interface LogLevelController {
  level: LogLevel
}

export class StoreSessionLoggerFactory implements SessionLoggerFactory {
  private readonly controller: LogLevelController

  constructor(
    private readonly store: SessionLogStore,
    private readonly options: StoreSessionLoggerFactoryOptions = {},
  ) {
    this.controller = {level: options.level ?? 'info'}
  }

  forApplication(bindings: LoggerBindings = {}): Logger {
    return new SessionStoreLogger(this.store, bindings, this.controller, this.options.onError)
  }

  forSession(sessionId: string, bindings: LoggerBindings = {}): Logger {
    return new SessionStoreLogger(
      this.store,
      {...bindings, sessionId, threadId: sessionId},
      this.controller,
      this.options.onError,
    )
  }
}

class SessionStoreLogger implements Logger {
  constructor(
    private readonly store: SessionLogStore,
    private readonly bindings: LoggerBindings,
    private readonly controller: LogLevelController,
    private readonly onError?: (error: Error) => void,
  ) {}

  get debug(): LogMethod {
    return this.method('debug')
  }

  get error(): LogMethod {
    return this.method('error')
  }

  get fatal(): LogMethod {
    return this.method('fatal')
  }

  get info(): LogMethod {
    return this.method('info')
  }

  get trace(): LogMethod {
    return this.method('trace')
  }

  get warn(): LogMethod {
    return this.method('warn')
  }

  child(bindings: LoggerBindings): Logger {
    return new SessionStoreLogger(this.store, {...this.bindings, ...bindings}, this.controller, this.onError)
  }

  isDebugEnabled(): boolean {
    return LEVEL_VALUES[this.controller.level] <= LEVEL_VALUES.debug
  }

  setDebugEnabled(enabled: boolean): void {
    this.controller.level = enabled ? 'debug' : 'info'
  }

  private method(level: LogLevel): LogMethod {
    return ((fieldsOrMessage: Error | LogFields | string, message?: string) => {
      if (LEVEL_VALUES[level] < LEVEL_VALUES[this.controller.level]) return
      const suppliedFields = typeof fieldsOrMessage === 'string' ? {} : normalizeFields(fieldsOrMessage)
      const fields = normalizeFields({...this.bindings, ...suppliedFields})
      const text =
        typeof fieldsOrMessage === 'string'
          ? fieldsOrMessage
          : (message ?? (fieldsOrMessage instanceof Error ? fieldsOrMessage.message : ''))
      const record = {
        fields: withoutCorrelationFields(fields),
        id: uuidv7(),
        level,
        message: text,
        timestamp: new Date().toISOString(),
        version: 1 as const,
        ...optionalString(fields, 'component'),
        ...optionalNumber(fields, 'iteration'),
        ...optionalString(fields, 'runId'),
        ...optionalString(fields, 'sessionId'),
        ...optionalString(fields, 'threadId'),
      }
      try {
        this.store.append(record)
      } catch (error) {
        reportLogStoreError(this.onError, error)
      }
    }) as LogMethod
  }
}

function normalizeFields(value: Error | LogFields): LogFields {
  if (value instanceof Error) {
    return {error: normalizeError(value)}
  }

  const normalized = normalizeValue(value, new Set())
  return isLogFields(normalized) ? normalized : {}
}

function normalizeValue(value: unknown, seen: Set<object>): LogValue {
  if (
    value === undefined ||
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value
  }

  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) return normalizeError(value)
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.map((item) => normalizeValue(item, seen))
    seen.delete(value)
    return result
  }

  const result: LogFields = {}
  for (const [key, item] of Object.entries(value)) {
    const normalized = isSensitiveLogKey(key) ? '[REDACTED]' : normalizeValue(item, seen)
    if (normalized !== undefined) result[key] = normalized
  }

  seen.delete(value)
  return result
}

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
  return (
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'setcookie' ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token')
  )
}

function normalizeError(error: Error): LogFields {
  return {
    message: error.message,
    name: error.name,
    ...(error.stack === undefined ? {} : {stack: error.stack}),
  }
}

function isLogFields(value: LogValue): value is LogFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Error)
}

function optionalString(fields: LogFields, key: string): Record<string, string> {
  const value = fields[key]
  return typeof value === 'string' ? {[key]: value} : {}
}

function optionalNumber(fields: LogFields, key: string): Record<string, number> {
  const value = fields[key]
  return typeof value === 'number' ? {[key]: value} : {}
}

function withoutCorrelationFields(fields: LogFields): LogFields {
  const result = {...fields}
  delete result.component
  delete result.iteration
  delete result.runId
  delete result.sessionId
  delete result.threadId
  return result
}
