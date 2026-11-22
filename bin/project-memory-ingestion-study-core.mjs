// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

import {projectMemoryOverlap, selectProjectMemory} from '../dist/core/projects/memory-context.js'
import {GptTokenizer} from '../dist/core/tokenizer/index.js'
import {historyOnly} from './project-memory-pilot.mjs'

export const limits = Object.freeze({
  bodyBytes: 8192,
  chunkBytes: 4096,
  entries: 128,
  prefixUnits: 1200,
  projectBytes: 1_048_576,
})

/** Model-facing data is produced only by the historical allowlist plus role/content offsets. */
export function historyWithOffsets(row) {
  return historyOnly(row).map((item) => {
    let start = 0
    const turns = row.haystack_sessions[item.originalIndex].map(({content, role}, turnIndex) => {
      const end = start + `${role}: ${content}`.length
      const turn = {end, start, turnIndex}
      start = end + 1
      return turn
    })
    return {...item, turns}
  })
}

function chunk(item, turns, ordinal) {
  const {start} = turns[0]
  const {end} = turns.at(-1)
  return {
    end,
    excerpt: item.text.slice(start, end),
    ordinal,
    originalIndex: item.originalIndex,
    start,
    title: `History ${item.date}`,
    turns: turns.map(({turnIndex}) => turnIndex),
  }
}

function pack(item, omitted) {
  const chunks = []
  let current = []
  const flush = () => {
    if (current.length > 0) chunks.push(chunk(item, current, chunks.length))
    current = []
  }

  for (const turn of item.turns) {
    const bytes = Buffer.byteLength(item.text.slice(turn.start, turn.end))
    if (bytes > limits.bodyBytes) {
      flush()
      omitted.push({end: turn.end, originalIndex: item.originalIndex, reason: 'oversize-turn', start: turn.start})
      continue
    }

    const combined = Buffer.byteLength(item.text.slice(current[0]?.start ?? turn.start, turn.end))
    if (combined > limits.chunkBytes) flush()
    current.push(turn)
  }

  flush()
  return chunks
}

export function ingestionPlan(history, condition) {
  if (condition === 'prefix') {
    const admitted = history.map((item) => {
      const excerpt = item.text.slice(0, limits.prefixUnits)
      return {
        end: excerpt.length,
        excerpt,
        originalIndex: item.originalIndex,
        start: 0,
        title: `History ${item.date}`,
        turns: item.turns.filter(({end}) => end <= excerpt.length).map(({turnIndex}) => turnIndex),
      }
    })
    return {admitted, omitted: []}
  }

  assert.equal(condition, 'turn-chunks', 'Unknown ingestion condition')
  const omitted = []
  const planned = history.flatMap((item) => pack(item, omitted))
  const queue = [...planned].sort((a, b) => a.ordinal - b.ordinal)
  const accepted = new Set()
  let totalBytes = 0
  for (const item of queue) {
    const bytes = Buffer.byteLength(item.excerpt)
    const reason =
      accepted.size >= limits.entries
        ? 'project-entry-cap'
        : totalBytes + bytes > limits.projectBytes
          ? 'project-byte-cap'
          : undefined
    if (reason) {
      const {end, originalIndex, start} = item
      omitted.push({end, originalIndex, reason, start})
      continue
    }

    accepted.add(item)
    totalBytes += bytes
  }

  return {admitted: planned.filter((item) => accepted.has(item)), omitted}
}

export function compactOffsets({end, entryId, originalIndex, start, turns}) {
  return {end, entryId, originalIndex, start, turns}
}

/** Gold coverage only after answer dispatch, or in deterministic replay with no model. */
export function annotationCoverage(row, history, chunks) {
  if (row.question_id.endsWith('_abs')) return {annotated: 0, complete: 0}
  const spans = new Map()
  for (const item of chunks) {
    const source = spans.get(item.originalIndex) ?? []
    source.push(item)
    spans.set(item.originalIndex, source)
  }

  let annotated = 0
  let complete = 0
  for (const item of history) {
    for (const turn of item.turns) {
      if (!row.haystack_sessions[item.originalIndex][turn.turnIndex]?.has_answer) continue
      annotated++
      if (spans.get(item.originalIndex)?.some((s) => s.start <= turn.start && s.end >= turn.end)) complete++
    }
  }

  return {annotated, complete}
}

const score = (item) => item.overlap * 10 + (item.entry.automatic?.importance ?? 1)

export function rankCandidates(entries, query) {
  return entries
    .filter((entry) => !entry.retired)
    .map((entry) => ({entry, overlap: projectMemoryOverlap(query, entry)}))
    .sort((a, b) => {
      const diff = query ? score(b) - score(a) : 0
      if (diff !== 0) return diff
      const x = a.entry
      const y = b.entry
      return y.updatedAt < x.updatedAt ? -1 : y.updatedAt > x.updatedAt ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0
    })
}

function fixtureId(n) {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

/** Stable offline metadata; real catalog UUIDs and dates are not required for replay. */
export function replayFixture(admitted) {
  const projectId = fixtureId(1)
  const entries = admitted.map((item, n) => {
    const timestamp = new Date(n).toISOString()
    return {
      body: item.excerpt,
      createdAt: timestamp,
      edited: false,
      id: fixtureId(20 + n),
      projectId,
      retired: false,
      revision: 1,
      sources: [
        {
          digest: '0'.repeat(64),
          messageId: fixtureId(200 + n),
          pairId: fixtureId(2),
          sessionId: fixtureId(400 + item.originalIndex),
        },
      ],
      title: item.title,
      updatedAt: timestamp,
    }
  })
  return {
    entries,
    membership: {pairId: fixtureId(2), projectId, revision: 1, sessionId: fixtureId(3), unavailable: false},
    project: {archived: false, id: projectId, memoryGeneration: entries.length},
  }
}

/** Fixed-query replay of canonical selected snapshots and the result budget; no provider or dispatch. */
export function replaySelection(admitted, query) {
  const catalog = replayFixture(admitted)
  const {
    entries,
    project: {id: projectId},
  } = catalog
  const snapshot = selectProjectMemory(catalog, {captureId: fixtureId(4), execution: 'agent', request: query})
  const ranked = rankCandidates(entries, query)
  const result = {
    generation: snapshot.generation,
    projectId,
    results: [],
    truncated: false,
    trust: 'untrusted-memory-evidence',
  }
  const tokenizer = new GptTokenizer()
  for (const entry of snapshot.entries.filter((e) => projectMemoryOverlap(query, e) > 0).slice(0, 6)) {
    const next = {...result, results: [...result.results, entry]}
    if (tokenizer.encode(JSON.stringify(next)).length > 2048) break
    result.results.push(entry)
  }

  return {
    exclusions: snapshot.exclusions,
    offsets: admitted.map((item, n) => compactOffsets({...item, entryId: entries[n].id})),
    preparedIds: snapshot.entries.map(({id}) => id),
    ranked: ranked.map(({entry, overlap}) => ({id: entry.id, overlap})),
    returnedIds: result.results.map(({id}) => id),
    topSixIds: ranked
      .filter(({overlap}) => overlap > 0)
      .slice(0, 6)
      .map(({entry}) => entry.id),
  }
}
