// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {CompactionAlgorithm} from './compaction-algorithm.js'
import type {CompactionStrategy} from './compaction-strategy.js'

import {handoffSummaryAlgorithm, structuredSummaryAlgorithm} from './compaction-algorithm.js'
import {budgetedCompactionStrategy, eoccCompactionStrategy, sacCompactionStrategy} from './compaction-strategy.js'

export interface CompactionComponents {
  algorithm: CompactionAlgorithm
  strategy: CompactionStrategy
}

const algorithms: Readonly<Record<string, CompactionAlgorithm>> = {
  [handoffSummaryAlgorithm.id]: handoffSummaryAlgorithm,
  [structuredSummaryAlgorithm.id]: structuredSummaryAlgorithm,
}
const strategies: Readonly<Record<string, CompactionStrategy>> = {
  [budgetedCompactionStrategy.id]: budgetedCompactionStrategy,
  [eoccCompactionStrategy.id]: eoccCompactionStrategy,
  [sacCompactionStrategy.id]: sacCompactionStrategy,
}

export function validateCompactionComponents({algorithm, strategy}: CompactionComponents): void {
  if (
    strategy.summarySchema !== algorithm.summarySchema ||
    (strategy.requiresCumulativeUpdates && !algorithm.supportsCumulativeUpdates)
  )
    throw new Error(`Incompatible compaction components: ${strategy.id} / ${algorithm.id}`)
}

/** Resolve only built-ins; configuration cannot load executable modules. */
export function resolveCompactionComponents(selection: {
  algorithm?: unknown
  strategy?: unknown
}): CompactionComponents {
  const algorithmId = selection.algorithm === undefined ? structuredSummaryAlgorithm.id : selection.algorithm
  const strategyId = selection.strategy === undefined ? budgetedCompactionStrategy.id : selection.strategy
  if (typeof strategyId !== 'string' || !Object.hasOwn(strategies, strategyId))
    throw new Error('Unknown compaction strategy')
  if (typeof algorithmId !== 'string' || !Object.hasOwn(algorithms, algorithmId))
    throw new Error('Unknown compaction algorithm')
  const components = {algorithm: algorithms[algorithmId], strategy: strategies[strategyId]}
  validateCompactionComponents(components)
  return components
}

export function resolveCompactionSelection(selection: {algorithm?: unknown; strategy?: unknown}): {
  algorithm: string
  strategy: string
} {
  const {algorithm, strategy} = resolveCompactionComponents(selection)
  return {algorithm: algorithm.id, strategy: strategy.id}
}
