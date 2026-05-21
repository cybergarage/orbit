// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Logger} from '../../src/core/index.js'

import {createLogger, createNoopLogger} from '../../src/core/index.js'

describe('logger', () => {
  it('creates a Logger with all standard log level methods', () => {
    const stream = new MemoryLogStream()
    const logger: Logger = createLogger({destination: stream, level: 'trace'})

    logger.trace('trace message')
    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')
    logger.fatal('fatal message')

    expect(stream.records.map((record) => record.msg)).to.deep.equal([
      'trace message',
      'debug message',
      'info message',
      'warn message',
      'error message',
      'fatal message',
    ])
  })

  it('writes structured log fields and a message', () => {
    const stream = new MemoryLogStream()
    const logger = createLogger({destination: stream})

    logger.info({component: 'mcp'}, 'started')

    expect(stream.records).to.have.length(1)
    expect(stream.records[0]).to.include({
      component: 'mcp',
      level: 30,
      msg: 'started',
    })
  })

  it('includes configured name and base bindings', () => {
    const stream = new MemoryLogStream()
    const logger = createLogger({
      bindings: {component: 'core'},
      destination: stream,
      name: 'orbit',
    })

    logger.info('ready')

    expect(stream.records[0]).to.include({
      component: 'core',
      msg: 'ready',
      name: 'orbit',
    })
  })

  it('creates child loggers that inherit and add bindings', () => {
    const stream = new MemoryLogStream()
    const logger = createLogger({
      bindings: {component: 'core'},
      destination: stream,
    })

    logger.child({traceId: 'trace-1'}).info('child ready')

    expect(stream.records[0]).to.include({
      component: 'core',
      msg: 'child ready',
      traceId: 'trace-1',
    })
  })

  it('logs Error instances as structured errors', () => {
    const stream = new MemoryLogStream()
    const logger = createLogger({destination: stream})

    logger.error(new Error('boom'), 'failed')

    expect(stream.records[0].msg).to.equal('failed')
    expect(stream.records[0].err).to.include({message: 'boom', type: 'Error'})
  })

  it('creates a no-op logger that safely accepts all methods', () => {
    const logger: Logger = createNoopLogger()
    const child = logger.child({component: 'test'})

    logger.trace('trace')
    logger.debug({component: 'test'}, 'debug')
    logger.info('info')
    logger.warn('warn')
    logger.error(new Error('boom'), 'error')
    logger.fatal('fatal')

    expect(child).to.equal(logger)
  })
})

class MemoryLogStream {
  readonly records: Array<Record<string, unknown>> = []

  write(message: string): void {
    this.records.push(JSON.parse(message) as Record<string, unknown>)
  }
}
