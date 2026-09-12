// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {z} from 'zod'

const id = z
  .string()
  .min(1)
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 2048)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const number = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER)
const strings = z.array(id)
const category = z.enum([
  'admission',
  'terminal',
  'quiescence',
  'artifact',
  'grading',
  'configuration',
  'isolation',
  'journal',
  'transcript',
  'measurements',
])
const stage = z.enum(['admitted', 'refused', 'not-run'])
const outcome = z.enum(['completed', 'failed', 'cancelled', 'budget-exceeded', 'incomplete'])
const recording = z.strictObject({
  level: z.enum(['memory', 'file-sync', 'file-and-directory-sync']),
  mode: z.enum(['memory', 'file']),
  status: z.enum(['acknowledged', 'failed', 'recovered']),
})
const verifier = z.strictObject({id, revision: id})
const configuration = z.strictObject({
  adapter: id,
  application: id,
  approval: id,
  catalog: id,
  dependencies: id,
  environment: id,
  graph: id,
  inputProfile: id,
  limits: id,
  mappingMethod: id,
  model: id,
  orbit: id,
  privateConfiguration: id,
  skills: id,
  target: id,
})
const slot = z.strictObject({caseId: id, repetition: integer})
const requirement = z.strictObject({
  category,
  core: z.boolean(),
  scope: id,
  stages: z.array(stage).min(1),
  verifiers: z.array(verifier),
})
const caseSchema = z.strictObject({
  checks: z
    .array(z.strictObject({grader: verifier, id, scope: id}))
    .min(1)
    .max(64),
  evidence: z.array(requirement).min(1),
  fixture: id,
  forbiddenChanges: strings,
  id,
  permittedOutcomes: z.array(z.union([outcome, z.literal('refused')])).min(1),
  recording: recording.omit({status: true}),
  refusalNotApplicable: z.array(z.enum(['terminal', 'journal', 'transcript', 'configuration'])),
  revision: id,
  role: z.enum(['development', 'held-out']),
})
export const planSchema = z.strictObject({
  cases: z.array(caseSchema).min(1),
  dimensions: z.array(
    z.enum(
      Object.keys(configuration.shape) as [keyof typeof configuration.shape, ...(keyof typeof configuration.shape)[]],
    ),
  ),
  id,
  revision: z.literal(1),
  suiteRevision: id,
  variants: z.array(z.strictObject({configuration, id, slots: z.array(slot).min(1)})).min(1),
})
const identity = z.strictObject({namespace: id, requestId: id, runId: id, sessionId: id, storageIdentity: id})
const runtime = z.strictObject({
  outcome,
  quiescence: z.boolean(),
  // Full original RunResult is checked by the journal validator; opaque raw JSON preserves it losslessly.
  raw: z.string(),
  recording,
})
const artifact = z.strictObject({
  after: id,
  before: id,
  fixture: id,
  frozen: z.enum(['read-only-copy', 'verified-unchanged']),
  id,
  method: id,
  postQuiescence: z.boolean(),
})
const check = z.strictObject({
  artifactId: id,
  error: z.enum(['none', 'exception', 'timeout', 'cancelled', 'missing']),
  grader: verifier,
  id,
  independent: z.boolean(),
  reason: id,
  result: z.enum(['pass', 'fail', 'indeterminate']),
  scope: id,
})
const hostEvidence = z.strictObject({
  capturedAt: id,
  category,
  complete: z.boolean(),
  findings: strings,
  highWater: integer,
  kind: z.literal('host'),
  payloadDigest: hash,
  scope: id,
  source: id,
  verifier,
})
const rawEvidence = z.strictObject({
  capturedAt: id,
  category: z.enum(['journal', 'transcript']),
  complete: z.boolean(),
  findings: strings,
  highWater: integer,
  kind: z.literal('core'),
  raw: z.string(),
  scope: id,
  source: id,
})
const metric = z.strictObject({
  // Explicit disjoint accounting cells, not labels inferred from timestamps or provider field names.
  cells: strings,
  clockEpoch: id,
  completeSource: z.boolean(),
  coverage: z.enum(['complete', 'partial', 'unavailable', 'not-applicable']),
  currency: id,
  id,
  includesApproval: z.boolean(),
  lowerBound: z.boolean(),
  method: id,
  modelVersion: id,
  provenance: z.enum([
    'live-final',
    'recovered',
    'visit-prefix',
    'diagnostic',
    'provider',
    'monotonic',
    'rate-estimate',
  ]),
  rateDate: id,
  rateRevision: id,
  reason: id,
  resource: id,
  rounding: z.enum(['none', 'half-up-6-decimals']),
  scope: id,
  source: id,
  sourceIds: strings,
  unit: z.enum(['count', 'token', 'millisecond', 'currency']),
  value: number.optional(),
})
export const attemptSchema = z.strictObject({
  admissionReason: id,
  artifact: artifact.nullable(),
  caseId: id,
  checks: z.array(check).max(64),
  configuration: configuration.nullable(),
  evidence: z.array(z.union([hostEvidence, rawEvidence])),
  id,
  identity: identity.nullable(),
  metrics: z.array(metric).max(64),
  noResources: z.boolean(),
  quiescent: z.boolean(),
  repetition: integer,
  runtime: runtime.nullable(),
  // Later observations do not replace the original terminal or become another trial.
  settlement: z.strictObject({capturedAt: id, confirmedStopped: z.boolean(), source: id}).nullable(),
  stage,
})
export const payloadSchema = z.strictObject({
  attempts: z.array(attemptSchema).max(1000),
  id,
  planDigest: hash,
  predecessor: id.nullable(),
  revision: z.literal(1),
  variant: id,
})
export const reportSchema = payloadSchema.extend({digest: hash})
export const importsSchema = z.strictObject({
  reports: z.array(reportSchema),
  revision: z.literal(1),
  selected: strings,
})

export type EvaluationPlan = z.infer<typeof planSchema>
export type EvaluationAttempt = z.infer<typeof attemptSchema>
export type EvaluationReport = z.infer<typeof reportSchema>
export type EvaluationReportPayload = z.infer<typeof payloadSchema>
export type EvaluationImports = z.infer<typeof importsSchema>
export type EvaluationMetric = z.infer<typeof metric>
export type EvaluationEvidence = EvaluationAttempt['evidence'][number]
export type EvaluationCategory = z.infer<typeof category>

export const resultSchema = z.strictObject({
  cleanupErrors: z.array(z.string()),
  operations: z.array(
    z.strictObject({
      id,
      status: z.enum(['cancelled-before-start', 'denied', 'failed', 'invalid', 'succeeded', 'unknown']),
    }),
  ),
  outcome,
  quiescence: z.boolean(),
  reason: z.string(),
  recording,
  runId: id,
  sessionId: id,
  stopRequest: z.string().optional(),
  unresolved: strings,
})
