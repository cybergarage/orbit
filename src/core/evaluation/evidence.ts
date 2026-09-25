// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {JournalRecord} from '../execution/journal.js'
import type {ParsedSessionFile} from '../session/codec.js'
import type {ParseBudget} from './json.js'
import type {EvaluationAttempt, EvaluationCategory, EvaluationPlan} from './schema.js'

import {validateNext} from '../execution/journal.js'
import {DEFAULT_RUN_LIMITS, parseRunLimits} from '../execution/limits.js'
import {inspectGraphRun} from '../processor/graph-inspection.js'
import {parseSessionFile} from '../session/codec.js'
import {digest, parseJSON, textBundle} from './json.js'
import {unique, validatePlan} from './plan.js'
import {attemptSchema, planSchema, resultSchema} from './schema.js'

export type EvaluationDisposition = 'fail' | 'indeterminate' | 'missing' | 'not-run' | 'pass'
export interface EvaluationInspection {
  attempt: EvaluationAttempt
  comparable: boolean
  disposition: EvaluationDisposition
  evidence: {category: EvaluationCategory; issues: string[]; kind: 'core' | 'host'; valid: boolean}[]
  issues: string[]
  runtime: string
}

/** Bind an attestation to all quality-affecting facts, not to its own signature/digest. */
export function claims(attempt: EvaluationAttempt): unknown {
  const facts = {...attempt}
  delete (facts as Partial<EvaluationAttempt>).evidence
  return facts
}

export function evaluationClaimsDigest(attemptText: string): string {
  textBundle([attemptText])
  return digest(claims(attemptSchema.parse(parseJSON(attemptText))))
}

function inspectJournal(
  parsed: unknown[],
  attempt: EvaluationAttempt,
  highWater: number,
  budget: ParseBudget,
): JournalRecord[] {
  const records: JournalRecord[] = []
  for (const record of parsed as JournalRecord[]) {
    validateNext(records, record)
    if (record.sessionId !== attempt.identity?.sessionId || record.runId !== attempt.identity.runId)
      throw new Error('Journal Run identity mismatch')
    records.push(record)
  }

  if (records.length !== highWater || records.length === 0) throw new Error('Journal high water mismatch')
  if (records[0].data.requestId !== attempt.identity?.requestId) throw new Error('Journal request mismatch')
  const terminal = records.find((r) => r.kind === 'run-terminal')
  if (!terminal || !attempt.runtime) throw new Error('Missing original terminal')
  const result = {...terminal.data}
  delete result.transcriptHighWater
  const terminalResult = resultSchema.parse(result)
  const admission = records[0].data
  if (admission.mode !== terminalResult.recording.mode || admission.level !== terminalResult.recording.level)
    throw new Error('Admission/terminal recording mismatch')
  for (const key of ['configuration', 'requestDigest']) {
    if (typeof admission[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(admission[key]))
      throw new Error('Missing admission identity digest')
  }

  const limits = admission.limits as Record<string, unknown> | undefined
  if (
    !limits ||
    Array.isArray(limits) ||
    typeof limits !== 'object' ||
    Object.keys(DEFAULT_RUN_LIMITS).some((key) => !Object.hasOwn(limits, key))
  )
    throw new Error('Invalid admitted limits')
  parseRunLimits(limits)
  const outcomes = new Map<string, string>()
  for (const entry of records) {
    if (entry.kind === 'operation-intent') outcomes.set(String(entry.data.operationId), 'unknown')
    if (entry.kind === 'operation-result') {
      if (
        !outcomes.has(String(entry.data.operationId)) &&
        !['cancelled-before-start', 'denied', 'invalid'].includes(String(entry.data.status))
      )
        throw new Error('Operation result has no intent')
      outcomes.set(String(entry.data.operationId), String(entry.data.status))
    }
  }

  if (
    digest([...terminalResult.operations].sort((a, b) => a.id.localeCompare(b.id))) !==
    digest([...outcomes].map(([id, status]) => ({id, status})).sort((a, b) => a.id.localeCompare(b.id)))
  )
    throw new Error('Terminal operation evidence mismatch')
  if (digest(result) !== digest(parseJSON(attempt.runtime.raw, budget, true)))
    throw new Error('Original terminal mismatch')
  return records
}

type EvaluationCase = EvaluationPlan['cases'][number]

function inspectAttestations(
  c: EvaluationCase,
  attempt: EvaluationAttempt,
  raw: Map<EvaluationCategory, string[]>,
): EvaluationInspection['evidence'] {
  const bound = digest(claims(attempt))
  return attempt.evidence.map((e) => {
    const requirement = c.evidence.find((r) => r.category === e.category && r.stages.includes(attempt.stage))
    const issues = e.kind === 'core' ? [...(raw.get(e.category) ?? [])] : []
    if (!e.complete || e.findings.length > 0) issues.push('Incomplete evidence', ...e.findings)
    if (!requirement) issues.push('Evidence is not applicable under trusted plan')
    else if (e.scope !== requirement.scope) issues.push('Evidence scope mismatch')
    if (e.kind === 'host') {
      if (!requirement?.verifiers.some((v) => v.id === e.verifier.id && v.revision === e.verifier.revision))
        issues.push('Untrusted verifier/revision')
      if (e.payloadDigest !== bound) issues.push('Attestation does not bind these facts')
    } else if (!requirement?.core) issues.push('Core inspection is not allowed by plan')
    return {category: e.category, issues, kind: e.kind, valid: issues.length === 0}
  })
}

function inspectRuntime(attempt: EvaluationAttempt, c: EvaluationCase, evidenceValid: boolean, budget: ParseBudget) {
  const issues: string[] = []
  let runtime = attempt.stage === 'admitted' ? 'unknown' : attempt.stage
  let terminalValid = false
  let unsettled = false
  if (attempt.runtime) {
    try {
      if (Buffer.byteLength(attempt.runtime.raw, 'utf8') > 1024 * 1024)
        throw new Error('Terminal evidence out of profile')
      const result = resultSchema.parse(parseJSON(attempt.runtime.raw, budget, true))
      if (
        result.runId !== attempt.identity?.runId ||
        result.sessionId !== attempt.identity.sessionId ||
        result.outcome !== attempt.runtime.outcome ||
        result.quiescence !== attempt.runtime.quiescence ||
        digest(result.recording) !== digest(attempt.runtime.recording)
      )
        throw new Error('Run result summary mismatch')
      terminalValid = evidenceValid
      if (!terminalValid) issues.push('Reliable terminal evidence unavailable')
      runtime = result.outcome
      unsettled =
        result.unresolved.length > 0 ||
        result.operations.some((o) => o.status === 'unknown') ||
        !result.quiescence ||
        result.outcome === 'incomplete'
      const levels = ['memory', 'file-sync', 'file-and-directory-sync']
      if (
        result.recording.status === 'failed' ||
        result.recording.mode !== c.recording.mode ||
        levels.indexOf(result.recording.level) < levels.indexOf(c.recording.level)
      )
        issues.push('Required recording unavailable')
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'Invalid terminal')
    }
  }

  return {issues, runtime, terminalValid, unsettled}
}

function gradeChecks(c: EvaluationCase, attempt: EvaluationAttempt, artifactValid: boolean, gradingValid: boolean) {
  return c.checks.map((required) => {
    const check = attempt.checks.find((check) => check.id === required.id)
    if (
      !check ||
      !artifactValid ||
      !gradingValid ||
      !check.independent ||
      digest(check.grader) !== digest(required.grader) ||
      check.scope !== required.scope ||
      check.artifactId !== attempt.artifact?.id ||
      check.error !== 'none'
    )
      return 'indeterminate'
    return check.result
  })
}

function inspectRaw(attempt: EvaluationAttempt, budget: ParseBudget): Map<EvaluationCategory, string[]> {
  const findings = new Map<EvaluationCategory, string[]>()
  let records: JournalRecord[] | undefined
  let transcript: ParsedSessionFile | undefined
  for (const item of attempt.evidence) {
    if (item.kind !== 'core') continue
    const issues: string[] = []
    findings.set(item.category, issues)
    try {
      if (!item.complete || item.findings.length > 0) throw new Error('Incomplete prefix or reader findings')
      if (!item.raw.endsWith('\n')) throw new Error('Unterminated evidence suffix')
      const lines = item.raw.slice(0, -1).split('\n')
      if (lines.some((line) => !line.trim())) throw new Error('Empty evidence record')
      // Parse raw JSON again with the shared value budget before calling legacy codecs.
      const parsed = lines.map((line) => {
        const limit = item.category === 'journal' ? 1024 * 1024 : 4 * 1024 * 1024
        if (Buffer.byteLength(line, 'utf8') > limit) throw new Error('Raw evidence out of profile')
        return parseJSON(line, budget, true)
      })
      if (item.category === 'journal') {
        records = inspectJournal(parsed, attempt, item.highWater, budget)
      } else {
        transcript = parseSessionFile(item.raw, '<supplied evaluation transcript>')
        if (
          transcript.recovered ||
          transcript.header.id !== attempt.identity?.sessionId ||
          transcript.entries.length - 1 !== item.highWater
        )
          throw new Error('Transcript identity/high water mismatch')
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'Invalid raw evidence')
    }
  }

  if (records && transcript && !findings.get('journal')?.length && !findings.get('transcript')?.length) {
    const entries = transcript.entries.slice(1)
    const add = (message: string) => {
      findings.get('transcript')!.push(message)
    }

    for (const record of records) {
      const high = record.data.transcriptHighWater
      if (high !== undefined && (!Number.isSafeInteger(high) || Number(high) < 0 || Number(high) > entries.length))
        add('Unavailable transcript prefix')
      if (record.kind === 'run-ready' && record.data.skills) {
        const snapshot = record.data.skills as {resolved: unknown; snapshotId: string}
        const skill = entries.find(
          (e) => e.type === 'skill_context' && e.id === snapshot.snapshotId && e.turnId === record.runId,
        )
        if (
          !skill ||
          skill.type !== 'skill_context' ||
          digest(skill.skills.map((s) => ({digest: s.digest, id: s.id}))) !== digest(snapshot.resolved)
        )
          add('Missing or different Skill snapshot')
      }
    }

    if (records.some((r) => r.kind === 'graph-bound')) {
      const graph = inspectGraphRun(records, {
        entries,
        formatVersion: transcript.header.version,
        sessionId: transcript.header.id,
      })
      if (graph.issue || graph.transcript !== 'verified') add(graph.issue ?? 'Unverified Graph transcript')
    }
  }

  return findings
}

export function inspectAttempt(
  plan: EvaluationPlan,
  variantId: string,
  attempt: EvaluationAttempt,
  budget: ParseBudget,
): EvaluationInspection {
  const variant = plan.variants.find((v) => v.id === variantId)
  const c = plan.cases.find((c) => c.id === attempt.caseId)
  if (!variant || !c || !variant.slots.some((s) => s.caseId === attempt.caseId && s.repetition === attempt.repetition))
    throw new Error('Attempt outside planned schedule')
  unique(
    attempt.evidence.map((e) => `${e.kind}:${e.category}`),
    'evidence category/inspector',
  )
  unique(
    attempt.checks.map((c) => c.id),
    'check',
  )
  if (
    (attempt.stage === 'admitted') !== (attempt.identity !== null) ||
    (attempt.stage !== 'admitted' && attempt.runtime !== null)
  )
    throw new Error('Invalid admission/Run binding')
  const raw = inspectRaw(attempt, budget)
  const evidence = inspectAttestations(c, attempt, raw)
  const valid = (category: EvaluationCategory) =>
    evidence.some((e) => e.category === category && e.valid) &&
    !evidence.some((e) => e.category === category && !e.valid)
  const issues = evidence.flatMap((e) => e.issues.map((s) => `${e.category}: ${s}`))
  for (const requirement of c.evidence)
    if (requirement.stages.includes(attempt.stage) && !valid(requirement.category))
      issues.push(`Required evidence unavailable: ${requirement.category}`)
  let comparable = attempt.configuration !== null && digest(attempt.configuration) === digest(variant.configuration)
  if (
    attempt.stage === 'refused' &&
    attempt.configuration === null &&
    c.refusalNotApplicable.includes('configuration') &&
    attempt.noResources &&
    valid('admission')
  )
    comparable = true
  if (!comparable && attempt.stage !== 'not-run') issues.push('Configuration is incomparable')
  const observed = inspectRuntime(attempt, c, valid('terminal') && !raw.get('journal')?.length, budget)
  const {runtime, terminalValid, unsettled} = observed
  issues.push(...observed.issues)
  const stopped =
    attempt.quiescent &&
    valid('quiescence') &&
    (attempt.stage === 'admitted'
      ? terminalValid && (attempt.runtime?.quiescence === true || attempt.settlement?.confirmedStopped === true)
      : attempt.noResources)
  const artifactValid =
    attempt.artifact !== null &&
    attempt.artifact.fixture === c.fixture &&
    attempt.artifact.before === attempt.artifact.after &&
    attempt.artifact.postQuiescence &&
    stopped &&
    valid('artifact') &&
    valid('isolation')
  const checks = gradeChecks(c, attempt, artifactValid, valid('grading'))
  if (checks.includes('indeterminate')) issues.push('Required grading unavailable or indeterminate')
  if (!stopped && attempt.stage !== 'not-run') issues.push('Quiescence is not confirmed')
  if (unsettled) issues.push('Original terminal retains unresolved task/effects')
  const reliableRuntime = attempt.stage === 'admitted' ? terminalValid : valid('admission') && attempt.noResources
  const allowed = c.permittedOutcomes.includes(runtime as (typeof c.permittedOutcomes)[number])
  let disposition: EvaluationDisposition = 'indeterminate'
  if (attempt.stage === 'not-run') {
    if (valid('admission') && attempt.noResources) disposition = 'not-run'
    else issues.push('Non-dispatch is unconfirmed')
  } else if (checks.includes('fail') || (reliableRuntime && !allowed && runtime !== 'incomplete')) disposition = 'fail'
  else if (
    checks.every((c) => c === 'pass') &&
    reliableRuntime &&
    allowed &&
    stopped &&
    !unsettled &&
    issues.every((s) => s === 'Configuration is incomparable')
  )
    disposition = 'pass'
  return {attempt, comparable, disposition, evidence, issues, runtime}
}

export function inspectEvaluationEvidence(
  planText: string,
  attemptText: string,
  variantId: string,
): EvaluationInspection {
  textBundle([planText, attemptText, variantId])
  const budget = {values: 0}
  const plan = validatePlan(planSchema.parse(parseJSON(planText, budget)))
  const attempt = attemptSchema.parse(parseJSON(attemptText, budget))
  return inspectAttempt(plan, variantId, attempt, budget)
}
