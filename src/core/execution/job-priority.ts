// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export type JobPriority = 'high' | 'low' | 'normal'

export interface ReadyJobCandidate {
  id: string
  key: string
  priority?: JobPriority
  ready: boolean
  sequence: number
}

export interface JobSchedulingState {
  waiting: {bypasses: number; id: string}[]
}

export const JOB_AGING_INTERVAL = 4
const maximumBypasses = 2 * JOB_AGING_INTERVAL
const ranks: Record<JobPriority, number> = {high: 2, low: 0, normal: 1}

/** Only explicit scheduling metadata is interpreted; never inspect a job payload. */
export function resolveJobPriority(value?: unknown): JobPriority {
  if (value === undefined) return 'normal'
  if (value !== 'high' && value !== 'normal' && value !== 'low') throw new Error('Invalid job priority')
  return value
}

export function validateJobSchedulingState(input: unknown): asserts input is JobSchedulingState {
  const state = input as JobSchedulingState
  if (!state || !Array.isArray(state.waiting)) throw new Error('Corrupt job scheduling state')
  const ids = new Set<string>()
  for (const entry of state.waiting) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      ids.has(entry.id) ||
      !Number.isSafeInteger(entry.bypasses) ||
      entry.bypasses < 0 ||
      entry.bypasses > maximumBypasses
    )
      throw new Error('Corrupt job scheduling counter')
    ids.add(entry.id)
  }
}

/** Select one eligible key head and mutate only the caller's transaction draft. */
export function selectReadyJob(jobs: ReadyJobCandidate[], state: JobSchedulingState): string | undefined {
  validateJobSchedulingState(state)
  const heads = candidateHeads(jobs)
  const waits = new Map(state.waiting.map((entry) => [entry.id, entry.bypasses]))
  const eligible = [...heads.values()]
    .filter((job) => job.ready)
    .map((job) => {
      const bypasses = waits.get(job.id) ?? 0
      const rank = Math.min(2, ranks[resolveJobPriority(job.priority)] + Math.floor(bypasses / JOB_AGING_INTERVAL))
      return {bypasses, job, rank}
    })
  eligible.sort(
    (left, right) => right.rank - left.rank || right.bypasses - left.bypasses || left.job.sequence - right.job.sequence,
  )
  const selected = eligible[0]
  if (!selected) return undefined
  waits.delete(selected.job.id)
  // Same-class FIFO waiting does not earn credit; only a higher base class can bypass it.
  for (const candidate of eligible)
    if (
      candidate.job.id !== selected.job.id &&
      ranks[resolveJobPriority(selected.job.priority)] > ranks[resolveJobPriority(candidate.job.priority)]
    )
      waits.set(candidate.job.id, Math.min(maximumBypasses, candidate.bypasses + 1))
  state.waiting = []
  // Retain blocked jobs' existing credits, discard terminal/absent jobs and use no object-key identities.
  for (const job of jobs) {
    const bypasses = waits.get(job.id)
    if (bypasses !== undefined) state.waiting.push({bypasses, id: job.id})
  }

  return selected.job.id
}

function candidateHeads(jobs: ReadyJobCandidate[]): Map<string, ReadyJobCandidate> {
  const ids = new Set<string>()
  const sequences = new Set<number>()
  const heads = new Map<string, ReadyJobCandidate>()
  for (const job of jobs) {
    if (
      !job ||
      typeof job.id !== 'string' ||
      !job.id ||
      typeof job.key !== 'string' ||
      !job.key ||
      typeof job.ready !== 'boolean' ||
      !Number.isSafeInteger(job.sequence) ||
      job.sequence <= 0 ||
      ids.has(job.id) ||
      sequences.has(job.sequence)
    )
      throw new Error('Invalid job candidate identity or order')
    resolveJobPriority(job.priority)
    ids.add(job.id)
    sequences.add(job.sequence)
    const previous = heads.get(job.key)
    if (!previous || job.sequence < previous.sequence) heads.set(job.key, job)
  }

  return heads
}
