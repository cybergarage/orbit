// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'

import {compareCase, summarize} from './project-memory-df-ranking.mjs'
import {digest} from './project-memory-ingestion-study-trace.mjs'
import {dataset, selectCases} from './project-memory-pilot.mjs'
import {readPinnedDataset} from './project-memory-turn-packing.mjs'

const expectedHoldout = 'f2b6da344cac943c6e01ae05b33df7714e42e0c062cb4fd1060fe8378e937d1b'
const expectedPilot = 'b72fedf8e7b2d95eaf8d991a0057d9c642dc80ce01096c98d3a18486b8a33690'
const namespace = 'orbit-longmemeval-holdout-v1'
const key = (row) => digest(`${namespace}:${row.question_id}`)
const abstains = (row) => row.question_id.endsWith('_abs')
const compare = (a, b) => (a < b ? -1 : Number(a > b))

export function selectHoldout(rows, excluded, size = 100) {
  const types = [...new Set(rows.map((row) => row.question_type))].sort(compare)
  assert(types.length > 0)
  const eligible = rows.filter((row) => !excluded.has(row.question_id))
  return types.flatMap((type, index) => {
    const quota = Math.floor(size / types.length) + Number(index < size % types.length)
    const group = eligible.filter((row) => row.question_type === type).sort((a, b) => compare(key(a), key(b)))
    const abstentions = group.filter((row) => abstains(row)).slice(0, Math.min(2, quota))
    const selected = [...abstentions, ...group.filter((row) => !abstains(row)).slice(0, quota - abstentions.length)]
    assert.equal(selected.length, quota, 'Unexpected quota shortfall')
    return selected
  })
}

const orderedIds = (group) => digest(JSON.stringify(group.map((row) => row.question_id)))

export function manifest(rows, pilot) {
  const counts = {}
  for (const row of rows) {
    counts[row.question_type] ??= {abstention: 0, answerable: 0}
    counts[row.question_type][abstains(row) ? 'abstention' : 'answerable']++
  }

  return {counts, dataset, namespace, orderedHoldoutSha256: orderedIds(rows), orderedPilotSha256: orderedIds(pilot)}
}

const cohorts = (cases) => ({
  abstention: summarize(cases.filter((row) => row.abstention)),
  answerable: summarize(cases.filter((row) => !row.abstention)),
})

async function main() {
  const args = process.argv.slice(2)
  assert(args.length === 0 || (args.length === 1 && args[0] === '--manifest'))
  const input = JSON.parse(await readPinnedDataset(process.stdin))
  const pilot = selectCases(input)
  const excluded = new Set(pilot.map((row) => row.question_id))
  const rows = selectHoldout(input, excluded)
  assert.equal(new Set(rows.map((row) => row.question_id)).size, 100)
  assert(rows.every(({question_id: id}) => !excluded.has(id)))
  const frozen = manifest(rows, pilot)
  assert.equal(frozen.orderedHoldoutSha256, expectedHoldout)
  assert.equal(frozen.orderedPilotSha256, expectedPilot)
  if (args[0] === '--manifest') {
    console.log(JSON.stringify(frozen, null, 2))
    return
  }

  const output = {}
  for (const [condition, mode] of [
    ['turn-chunks', 'whole'],
    ['turn-chunks', 'both'],
    ['prefix', 'whole'],
  ]) {
    const paired = rows.map((row, index) => ({
      ordinal: index + 1,
      type: row.question_type,
      ...compareCase(row, condition, mode),
    }))
    const aggregate = cohorts(paired)
    assert.equal(aggregate.abstention.cases, 8)
    assert.equal(aggregate.answerable.cases, 92)
    const byType = Object.fromEntries(
      Object.keys(frozen.counts).map((type) => [type, cohorts(paired.filter((row) => row.type === type))]),
    )
    output[`${condition}/${mode}`] = {...aggregate, byType, paired}
  }

  console.log(JSON.stringify({manifest: frozen, output, providerCalls: 0}, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
