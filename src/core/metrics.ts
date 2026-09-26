// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Counter, Gauge, Histogram, Registry} from 'prom-client'

import type {RunOutcome} from './execution/run.js'
import type {ModelTokenUsage} from './models/model.js'

/** Aggregate observations only. Implementations must not retain session content or identifiers. */
export interface OperationalMetrics {
  modelRequest(outcome: 'completed' | 'failed', usage?: ModelTokenUsage): void
  runAdmitted(): void
  runSettled(outcome: RunOutcome, durationMs: number): void
  toolCall(outcome: 'completed' | 'failed'): void
}

/** One registry per application service; no global Prometheus registry is used. */
export class PrometheusOperationalMetrics implements OperationalMetrics {
  private readonly registry = new Registry()
  private readonly active = new Gauge({
    help: 'Runs awaiting a terminal result in this process.',
    name: 'orbit_runs_active',
    registers: [this.registry],
  })
  private readonly modelRequests = new Counter({
    help: 'Completed and failed provider attempts.',
    labelNames: ['outcome'] as const,
    name: 'orbit_model_requests_total',
    registers: [this.registry],
  })
  private readonly modelTokens = new Counter({
    help: 'Provider-reported model input or output tokens.',
    labelNames: ['direction'] as const,
    name: 'orbit_model_tokens_total',
    registers: [this.registry],
  })
  private readonly runDuration = new Histogram({
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 900, 3600],
    help: 'Time from Run admission to terminal result, including cleanup.',
    labelNames: ['outcome'] as const,
    name: 'orbit_run_duration_seconds',
    registers: [this.registry],
  })
  private readonly runs = new Counter({
    help: 'Terminal Runs by outcome in this process.',
    labelNames: ['outcome'] as const,
    name: 'orbit_runs_total',
    registers: [this.registry],
  })
  private readonly toolCalls = new Counter({
    help: 'Completed and failed tool dispatches.',
    labelNames: ['outcome'] as const,
    name: 'orbit_tool_calls_total',
    registers: [this.registry],
  })

  get contentType(): string {
    return this.registry.contentType
  }

  modelRequest(outcome: 'completed' | 'failed', usage?: ModelTokenUsage): void {
    this.modelRequests.inc({outcome})
    if (outcome !== 'completed' || usage === undefined) return
    if (Number.isFinite(usage.inputTokens) && usage.inputTokens! >= 0)
      this.modelTokens.inc({direction: 'input'}, usage.inputTokens!)
    if (Number.isFinite(usage.outputTokens) && usage.outputTokens! >= 0)
      this.modelTokens.inc({direction: 'output'}, usage.outputTokens!)
  }

  render(): Promise<string> {
    return this.registry.metrics()
  }

  runAdmitted(): void {
    this.active.inc()
  }

  runSettled(outcome: RunOutcome, durationMs: number): void {
    this.active.dec()
    this.runs.inc({outcome})
    if (Number.isFinite(durationMs) && durationMs >= 0) this.runDuration.observe({outcome}, durationMs / 1000)
  }

  toolCall(outcome: 'completed' | 'failed'): void {
    this.toolCalls.inc({outcome})
  }
}
