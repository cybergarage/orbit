// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export const OrbitErrorCode = {
  ContextOverflow: 'CONTEXT_OVERFLOW',
  ExecutorSequenceEmpty: 'EXECUTOR_SEQUENCE_EMPTY',
  InvalidConfiguration: 'INVALID_CONFIGURATION',
  InvalidInput: 'INVALID_INPUT',
  ModelAborted: 'MODEL_ABORTED',
} as const

export type OrbitErrorCode = (typeof OrbitErrorCode)[keyof typeof OrbitErrorCode]

export interface OrbitErrorOptions {
  cause?: unknown
  code?: OrbitErrorCode
}

export class OrbitError extends Error {
  public readonly code?: OrbitErrorCode

  constructor(message: string, options: OrbitErrorOptions = {}) {
    super(message, {cause: options.cause})
    this.name = new.target.name
    this.code = options.code
  }

  static isInstance(error: unknown): error is OrbitError {
    return error instanceof OrbitError
  }
}

export class InvalidInputError extends OrbitError {
  constructor(message: string, options: Omit<OrbitErrorOptions, 'code'> = {}) {
    super(message, {...options, code: OrbitErrorCode.InvalidInput})
  }
}

export class InvalidConfigurationError extends OrbitError {
  constructor(message: string, options: Omit<OrbitErrorOptions, 'code'> = {}) {
    super(message, {...options, code: OrbitErrorCode.InvalidConfiguration})
  }
}

export class ExecutorSequenceEmptyError extends OrbitError {
  constructor(
    message = 'ExecutorSequence requires at least one executor.',
    options: Omit<OrbitErrorOptions, 'code'> = {},
  ) {
    super(message, {...options, code: OrbitErrorCode.ExecutorSequenceEmpty})
  }
}

export class ModelAbortError extends OrbitError {
  constructor(message: string, options: Omit<OrbitErrorOptions, 'code'> = {}) {
    super(message, {...options, code: OrbitErrorCode.ModelAborted})
  }
}

export class ContextOverflowError extends OrbitError {
  constructor(message: string, options: Omit<OrbitErrorOptions, 'code'> = {}) {
    super(message, {...options, code: OrbitErrorCode.ContextOverflow})
  }
}
