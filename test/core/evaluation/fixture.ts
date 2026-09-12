// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {EvaluationAttempt, EvaluationMetric, EvaluationPlan, EvaluationReport} from '../../../src/index.js'

import {evaluationClaimsDigest, sealEvaluationReport, validateEvaluationPlan} from '../../../src/index.js'

export const verifier = {id: 'isolated-host', revision: 'host-1'}
export function plan(repetitions = 1, variants = 1): EvaluationPlan {
  const configuration = {
    adapter: 'adapter-1',
    application: 'app-1',
    approval: 'ask',
    catalog: 'coding-1',
    dependencies: 'lock-1',
    environment: 'isolated-unix',
    graph: 'none',
    inputProfile: 'default-1',
    limits: 'profile-1',
    mappingMethod: 'portable-1',
    model: 'fixed-double',
    orbit: 'source-1',
    privateConfiguration: 'private-1',
    skills: 'ordered-none',
    target: 'fixture-1',
  }
  return {
    cases: [
      {
        checks: [
          {
            grader: {id: 'oracle', revision: '1'},
            id: 'independent-output',
            scope: 'expected-output-and-forbidden-changes',
          },
        ],
        evidence: [
          'admission',
          'terminal',
          'quiescence',
          'artifact',
          'grading',
          'configuration',
          'isolation',
          'measurements',
        ].map((category) => ({
          category: category as EvaluationPlan['cases'][number]['evidence'][number]['category'],
          core: false,
          scope: 'whole-attempt',
          stages:
            category === 'admission'
              ? ['admitted', 'refused', 'not-run']
              : category === 'terminal' || category === 'configuration' || category === 'measurements'
                ? ['admitted']
                : ['admitted', 'refused'],
          verifiers: [verifier],
        })),
        fixture: 'fixture-1',
        forbiddenChanges: ['outside-target'],
        id: 'case',
        permittedOutcomes: ['completed'],
        recording: {level: 'memory', mode: 'memory'},
        refusalNotApplicable: ['terminal', 'journal', 'transcript', 'configuration'],
        revision: 'case-1',
        role: 'development',
      },
    ],
    dimensions: ['graph'],
    id: 'suite',
    revision: 1,
    suiteRevision: 'suite-1',
    variants: Array.from({length: variants}, (_, i) => ({
      configuration: {...configuration},
      id: `variant-${i}`,
      slots: Array.from({length: repetitions}, (_, repetition) => ({caseId: 'case', repetition})),
    })),
  }
}

export function attest(a: EvaluationAttempt, p = plan()): EvaluationAttempt {
  const hash = evaluationClaimsDigest(JSON.stringify(a))
  a.evidence = p.cases[0].evidence
    .filter((r) => r.stages.includes(a.stage) && !r.core)
    .map((r) => ({
      capturedAt: '2026-09-13T00:00:00Z',
      category: r.category,
      complete: true,
      findings: [],
      highWater: 1,
      kind: 'host',
      payloadDigest: hash,
      scope: 'whole-attempt',
      source: 'collector-1',
      verifier,
    }))
  return a
}

export function attempt(repetition = 0, variant = 0): EvaluationAttempt {
  const sessionId = `session-${variant}-${repetition}`
  const runId = `run-${variant}-${repetition}`
  const result = {
    cleanupErrors: [],
    operations: [],
    outcome: 'completed',
    quiescence: true,
    reason: '',
    recording: {level: 'memory', mode: 'memory', status: 'acknowledged'},
    runId,
    sessionId,
    unresolved: [],
  }
  return attest({
    admissionReason: 'admitted',
    artifact: {
      after: 'final-content-1',
      before: 'final-content-1',
      fixture: 'fixture-1',
      frozen: 'read-only-copy',
      id: 'artifact-1',
      method: 'sha256-tree-v1',
      postQuiescence: true,
    },
    caseId: 'case',
    checks: [
      {
        artifactId: 'artifact-1',
        error: 'none',
        grader: {id: 'oracle', revision: '1'},
        id: 'independent-output',
        independent: true,
        reason: 'expected',
        result: 'pass',
        scope: 'expected-output-and-forbidden-changes',
      },
    ],
    configuration: plan().variants[0].configuration,
    evidence: [],
    id: `attempt-${variant}-${repetition}`,
    identity: {
      namespace: `pair-${variant}-${repetition}`,
      requestId: 'request',
      runId,
      sessionId,
      storageIdentity: `storage-${variant}-${repetition}`,
    },
    metrics: [],
    noResources: false,
    quiescent: true,
    repetition,
    runtime: {
      outcome: 'completed',
      quiescence: true,
      raw: JSON.stringify(result),
      recording: {level: 'memory', mode: 'memory', status: 'acknowledged'},
    },
    settlement: null,
    stage: 'admitted',
  })
}

export function report(
  p: EvaluationPlan,
  attempts: EvaluationAttempt[],
  variant = 'variant-0',
  id = `report-${variant}`,
  predecessor: null | string = null,
): EvaluationReport {
  return sealEvaluationReport(
    JSON.stringify({
      attempts,
      id,
      planDigest: validateEvaluationPlan(JSON.stringify(p)).digest,
      predecessor,
      revision: 1,
      variant,
    }),
  )
}

export function metric(): EvaluationMetric {
  return {
    cells: ['normal', 'summary'],
    clockEpoch: 'not-applicable',
    completeSource: true,
    coverage: 'complete',
    currency: 'not-applicable',
    id: 'model-calls',
    includesApproval: false,
    lowerBound: false,
    method: 'final-counter-1',
    modelVersion: 'fixed-double',
    provenance: 'live-final',
    rateDate: 'not-applicable',
    rateRevision: 'not-applicable',
    reason: 'live final snapshot',
    resource: 'modelCalls',
    rounding: 'none',
    scope: 'normal-and-summary',
    source: 'attempt-snapshot-1',
    sourceIds: ['final'],
    unit: 'count',
    value: 2,
  }
}
