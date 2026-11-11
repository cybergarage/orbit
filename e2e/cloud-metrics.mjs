// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {compactionMetrics} from './compaction-config.mjs'

export const pricing = JSON.parse(fs.readFileSync(new URL('cloud-pricing.json', import.meta.url), 'utf8'))
const count = (value) => Number.isSafeInteger(value) && value >= 0

// Canonical input includes cache reads/writes. Anthropic's input_tokens excludes both.
export function cloudUsage(data, provider) {
  const usage = data.response?.usage
  if (!usage) return null
  let cacheRead
  let cacheWrite1h = 0
  let cacheWrite5m = 0
  let input
  let output
  if (provider === 'openai') {
    input = usage.prompt_tokens
    cacheRead = usage.prompt_tokens_details?.cached_tokens
    output = usage.completion_tokens
    if (!count(input) || !count(cacheRead) || cacheRead > input) return null
    input -= cacheRead
  } else if (provider === 'anthropic') {
    input = usage.input_tokens
    cacheRead = usage.cache_read_input_tokens
    const writes = usage.cache_creation_input_tokens
    if (!count(writes)) return null
    if (writes > 0) {
      cacheWrite5m = usage.cache_creation?.ephemeral_5m_input_tokens
      cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens
      if (!count(cacheWrite5m) || !count(cacheWrite1h) || cacheWrite5m + cacheWrite1h !== writes) return null
    }

    output = usage.output_tokens
  } else return null
  if (![input, cacheRead, cacheWrite5m, cacheWrite1h, output].every((value) => count(value))) return null
  return {
    cacheRead,
    cacheWrite1h,
    cacheWrite5m,
    input,
    output,
    totalInput: input + cacheRead + cacheWrite5m + cacheWrite1h,
  }
}

export function cloudMetrics(events, {model, provider}) {
  const base = compactionMetrics(events)
  const rate = pricing.rates[`${provider}/${model}`]
  const totals = {cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 0, output: 0, totalInput: 0}
  const phases = {summary: {input: 0, output: 0}, worker: {input: 0, output: 0}}
  let accounted = 0
  let observedCost = 0
  let peak = 0
  let phase = 'worker'
  const pending = []
  const returnedModels = new Set()
  for (const event of events) {
    if (event.type === 'context.summary.started') phase = 'summary'
    if (['context.summary.completed', 'context.summary.failed'].includes(event.type)) phase = 'worker'
    if (event.type === 'model.request.started') pending.push(phase)
    if (['model.response.completed', 'model.response.failed'].includes(event.type)) {
      const requestPhase = pending.shift()
      if (event.type !== 'model.response.completed') continue
      const data = event.data ?? {}
      returnedModels.add(data.model)
      const usage = cloudUsage(data, provider)
      if (!usage || !requestPhase || data.provider !== provider || data.model !== model) continue
      accounted++
      for (const key of Object.keys(totals)) totals[key] += usage[key]
      peak = Math.max(peak, usage.totalInput)
      phases[requestPhase].input += usage.totalInput
      phases[requestPhase].output += usage.output
      if (rate)
        observedCost +=
          (usage.input * rate.input +
            usage.cacheRead * rate.cacheRead +
            usage.cacheWrite5m * (rate.cacheWrite5m ?? 0) +
            usage.cacheWrite1h * (rate.cacheWrite1h ?? 0) +
            usage.output * rate.output) /
          1e6
    }
  }

  const complete = base.modelCallsStarted > 0 && base.usageComplete && accounted === base.modelCallsStarted
  const number = (type) => events.filter((event) => event.type === type).length
  return {
    ...base,
    accountedResponses: accounted,
    accountingSource: 'final-provider-events',
    billedCostUSD: null,
    cacheTokens: complete ? totals.cacheRead : null,
    cacheUsageComplete: complete,
    cacheWrite1hTokens: complete ? totals.cacheWrite1h : null,
    cacheWrite5mTokens: complete ? totals.cacheWrite5m : null,
    compactionFailures: number('context.compaction.failed'),
    compactionStarts: number('context.compaction.started'),
    estimatedListCostUSD: complete && rate ? observedCost : null,
    inputTokens: totals.totalInput,
    model,
    observedListCostUSD: rate ? observedCost : null,
    outputTokens: totals.output,
    peakInputTokens: accounted ? peak : null,
    pricingAsOf: pricing.asOf,
    pricingSource: rate?.source ?? null,
    provider,
    returnedModels: [...returnedModels],
    summaryInputTokens: phases.summary.input,
    summaryOutputTokens: phases.summary.output,
    summaryTruncations: number('context.summary.truncated'),
    summaryValidationFailures: number('context.summary.validation-failed'),
    uncachedInputTokens: complete ? totals.input : null,
    usageComplete: complete,
    workerInputTokens: phases.worker.input,
    workerOutputTokens: phases.worker.output,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, provider, model] = process.argv.slice(2)
  const events = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  console.log(JSON.stringify(cloudMetrics(events, {model, provider}), null, 2))
}
