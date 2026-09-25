// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export interface RunLimits {
  approvalMs: number
  cleanupMs: number
  elapsedMs: number
  mcpServers: number
  mcpStartupMs: number
  modelCalls: number
  toolRequests: number
  toolRounds: number
}

export const DEFAULT_RUN_LIMITS: Readonly<RunLimits> = Object.freeze({
  approvalMs: 300_000,
  cleanupMs: 5000,
  elapsedMs: 3_600_000,
  mcpServers: 16,
  mcpStartupMs: 30_000,
  modelCalls: 101,
  toolRequests: 1000,
  toolRounds: 100,
})

/** Validate untrusted partial settings without silently accepting misspelled limits. */
export function parseRunLimits(value: unknown): Partial<RunLimits> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Run limits must be an object')
  for (const [name, limit] of Object.entries(value)) {
    if (
      !Object.hasOwn(DEFAULT_RUN_LIMITS, name) ||
      !Number.isSafeInteger(limit) ||
      (name.endsWith('Ms') ? limit <= 0 : limit < 0) ||
      (name.endsWith('Ms') && limit > 2_147_483_647)
    )
      throw new Error(`Invalid run limit: ${name}`)
  }

  return {...value}
}

export interface BudgetExhaustion {
  consumed: number
  limit: number
  limitName: keyof RunLimits
  requested: number
}

/** Uses the existing journal reason field; old generic reasons remain readable. */
export function budgetReason(detail: BudgetExhaustion): string {
  return `budget-exceeded:${detail.limitName}:${detail.limit}:${detail.consumed}:${detail.requested}`
}

export function parseBudgetReason(reason: string): BudgetExhaustion | undefined {
  const [prefix, limitName, limit, consumed, requested, extra] = reason.split(':')
  const values = [limit, consumed, requested].map(Number)
  if (
    prefix !== 'budget-exceeded' ||
    !Object.hasOwn(DEFAULT_RUN_LIMITS, limitName ?? '') ||
    extra !== undefined ||
    [limit, consumed, requested].some((v) => !v || !/^\d+$/u.test(v)) ||
    values.some((v) => !Number.isSafeInteger(v) || v < 0)
  )
    return undefined
  return {consumed: values[1], limit: values[0], limitName: limitName as keyof RunLimits, requested: values[2]}
}
