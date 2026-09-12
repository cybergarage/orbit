// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {EvaluationAttempt, EvaluationPlan, EvaluationReport} from '../../../src/index.js'

import {
  compareEvaluationReports,
  EVALUATION_FORMAT_LIMITS,
  evaluationClaimsDigest,
  evaluationDigest,
  inspectEvaluationEvidence,
  sealEvaluationReport,
  validateEvaluationPlan,
} from '../../../src/index.js'
import {attempt, attest, metric, plan, report} from './fixture.js'

const compare = (p: EvaluationPlan, reports: EvaluationReport[], selected = reports.map((r) => r.id)) =>
  compareEvaluationReports(JSON.stringify(p), JSON.stringify({reports, revision: 1, selected}))
const inspect = (a: EvaluationAttempt, p = plan()) =>
  inspectEvaluationEvidence(JSON.stringify(p), JSON.stringify(a), 'variant-0')
const outcome = (a: EvaluationAttempt, value: NonNullable<EvaluationAttempt['runtime']>['outcome']) => {
  a.runtime!.outcome = value
  a.runtime!.raw = JSON.stringify({...JSON.parse(a.runtime!.raw), outcome: value})
  return attest(a)
}

describe('evaluation API contracts', () => {
  describe('read-only workflow evaluation', () => {
    it('exports bounded text APIs and isolates returned values', () => {
      const text = JSON.stringify(plan())
      const first = validateEvaluationPlan(text)
      first.plan.cases[0].id = 'changed'
      expect(validateEvaluationPlan(text).plan.cases[0].id).eq('case')
      expect(Object.isFrozen(EVALUATION_FORMAT_LIMITS)).eq(true)
      expect(evaluationDigest('{"b":-0,"a":1}')).eq(evaluationDigest('{"a":1,"b":0}'))
      expect(evaluationDigest('[1,2]')).not.eq(evaluationDigest('[2,1]'))
    })

    it('rejects getters, proxies and nonstrings without property access', () => {
      let reads = 0
      const proxy = new Proxy(
        {},
        {
          get() {
            reads++
            throw new Error('effect')
          },
          ownKeys() {
            reads++
            throw new Error('effect')
          },
        },
      )
      for (const value of [
        proxy,
        {
          get input() {
            reads++
            return 'bad'
          },
        },
        null,
        1,
        [],
        new Object('{}'),
      ]) {
        expect(() => validateEvaluationPlan(value as string)).throw('JSON text')
        expect(() => compareEvaluationReports(JSON.stringify(plan()), value as string)).throw('JSON text')
        expect(() => evaluationClaimsDigest(value as string)).throw('JSON text')
        expect(() => sealEvaluationReport(value as string)).throw('JSON text')
      }

      expect(reads).eq(0)
    })
    for (const [name, text] of Object.entries({
      bom: '\uFEFF{}',
      comma: '[1,]',
      control: '"\n"',
      duplicate: '{"a":1,"a":2}',
      escapedDuplicate: String.raw`{"a":1,"\u0061":2}`,
      infinity: '1e999',
      negativeSurrogate: String.raw`"\udfff"`,
      surrogate: String.raw`"\ud800"`,
      trailing: '{}x',
      unsafe: '9007199254740993',
    })) {
      it(`rejects ${name} JSON`, () => {
        expect(() => evaluationDigest(text)).throw()
      })
    }

    it('bounds byte size, decoded strings, depth and values before schema traversal', () => {
      expect(() => evaluationDigest(JSON.stringify('é'.repeat(1024)))).not.throw()
      expect(() => evaluationDigest(JSON.stringify('é'.repeat(1025)))).throw()
      expect(() => evaluationDigest('['.repeat(34) + '0' + ']'.repeat(34))).throw()
      expect(() => evaluationDigest('[' + '0,'.repeat(200_000) + '0]')).throw()
      expect(() => evaluationDigest(' '.repeat(EVALUATION_FORMAT_LIMITS.bytes + 1))).throw('byte limit')
      expect(() => evaluationDigest(' '.repeat(EVALUATION_FORMAT_LIMITS.bytes - 2) + '{}')).not.throw()
      expect(() => evaluationDigest('[' + '0,'.repeat(199_998) + '0]')).not.throw()
    })

    it('keeps metadata closed and does not normalize Unicode identifiers', () => {
      expect(evaluationDigest('"é"')).not.eq(evaluationDigest('"é"'))
      expect(() => validateEvaluationPlan(JSON.stringify({...plan(), constructor: 'bad'}))).throw()
      expect(() => validateEvaluationPlan(JSON.stringify({...plan(), revision: 2}))).throw()
      expect(() => validateEvaluationPlan(JSON.stringify({...plan(), variants: []}))).throw()
    })

    it('requires independent checks, minimum trust and equal declared schedules', () => {
      const p = plan(2, 2)
      p.cases[0].checks = []
      expect(() => validateEvaluationPlan(JSON.stringify(p))).throw()
      p.cases[0].checks = plan().cases[0].checks
      p.variants[1].slots.pop()
      expect(() => validateEvaluationPlan(JSON.stringify(p))).throw('schedules')
      p.variants[1].slots = p.variants[0].slots
      p.variants[1].configuration.model = 'other'
      expect(() => validateEvaluationPlan(JSON.stringify(p))).throw('Undeclared')
      p.dimensions.push('model')
      expect(() => validateEvaluationPlan(JSON.stringify(p))).not.throw()
      p.cases[0].evidence = p.cases[0].evidence.filter((e) => e.category !== 'artifact')
      expect(() => validateEvaluationPlan(JSON.stringify(p))).throw('mandatory')
    })

    it('retains five slots and exact two-of-five pass accounting', () => {
      const p = plan(5)
      const trials = [attempt(0), attempt(1), outcome(attempt(2), 'failed'), attempt(3)]
      trials[3].evidence = []
      const result = compare(p, [report(p, trials)])
      expect(result.variants[0].counts).deep.eq({fail: 1, indeterminate: 1, missing: 1, 'not-run': 0, pass: 2})
      expect(result.variants[0]).include({passes: 2, planned: 5})
      expect(result.rows[4].inspection).to.be.an('undefined')
    })
    for (const value of ['completed', 'failed', 'cancelled', 'budget-exceeded', 'incomplete'] as const) {
      it(`keeps ${value} runtime separate from expected task quality`, () => {
        const p = plan()
        p.cases[0].permittedOutcomes = [value]
        const a = outcome(attempt(), value)
        const result = inspect(a, p)
        expect(result.runtime).eq(value)
        expect(result.disposition).eq(value === 'incomplete' ? 'indeterminate' : 'pass')
      })
    }

    it('requires declared refusal evidence and never invents a Run', () => {
      const p = plan()
      p.cases[0].permittedOutcomes = ['refused']
      const a = attempt()
      Object.assign(a, {configuration: null, identity: null, noResources: true, runtime: null, stage: 'refused'})
      attest(a, p)
      expect(inspect(a, p).disposition).eq('pass')
      a.noResources = false
      attest(a, p)
      expect(inspect(a, p).disposition).eq('indeterminate')
    })

    it('distinguishes authoritative not-run from absent or unconfirmed reports', () => {
      const p = plan(2)
      const a = attempt()
      Object.assign(a, {
        artifact: null,
        checks: [],
        configuration: null,
        identity: null,
        noResources: true,
        runtime: null,
        stage: 'not-run',
      })
      attest(a, p)
      const result = compare(p, [report(p, [a])])
      expect(result.variants[0].counts).include({missing: 1, 'not-run': 1})
      a.evidence = []
      expect(inspect(a).disposition).eq('indeterminate')
      expect(compare(p, []).variants[0].counts.missing).eq(2)
    })
    for (const problem of ['missing', 'verifier', 'revision', 'binding', 'incomplete', 'findings'] as const) {
      it(`does not accept ${problem} required evidence as a pass`, () => {
        const a = attempt()
        const item = a.evidence.find((e) => e.category === 'terminal')!
        if (item.kind !== 'host') throw new Error('fixture')
        if (problem === 'missing') a.evidence = a.evidence.filter((e) => e !== item)
        if (problem === 'verifier') item.verifier = {...item.verifier, id: 'candidate'}
        if (problem === 'revision') item.verifier = {...item.verifier, revision: 'new'}
        if (problem === 'binding') item.payloadDigest = '0'.repeat(64)
        if (problem === 'incomplete') item.complete = false
        if (problem === 'findings') item.findings = ['lost suffix']
        expect(inspect(a).disposition).eq('indeterminate')
      })
    }

    it('preserves decisive independent failure alongside unknown checks', () => {
      const p = plan()
      p.cases[0].checks.push({grader: {id: 'oracle', revision: '1'}, id: 'second', scope: 'second-scope'})
      const a = attempt()
      a.checks[0].result = 'fail'
      a.checks[0].reason = 'Forbidden file changed even though target tests passed'
      attest(a, p)
      expect(inspect(a, p).disposition).eq('fail')
      expect(inspect(a, p).issues).include('Required grading unavailable or indeterminate')
      a.evidence = a.evidence.filter((e) => e.category !== 'grading')
      expect(inspect(a, p).disposition).eq('indeterminate')
    })
    for (const error of ['exception', 'timeout', 'cancelled', 'missing'] as const) {
      it(`keeps grader ${error} distinct from candidate failure`, () => {
        const a = attempt()
        a.checks[0].error = error
        a.checks[0].result = 'fail'
        expect(inspect(attest(a)).disposition).eq('indeterminate')
      })
    }

    it('rejects grading a changed, unfrozen or non-independent artifact', () => {
      for (const change of [
        (a: EvaluationAttempt) => {
          a.artifact!.after = 'changed'
        },
        (a: EvaluationAttempt) => {
          a.artifact!.postQuiescence = false
        },
        (a: EvaluationAttempt) => {
          a.checks[0].independent = false
        },
        (a: EvaluationAttempt) => {
          a.checks[0].artifactId = 'other'
        },
        (a: EvaluationAttempt) => {
          a.quiescent = false
        },
      ]) {
        const a = attempt()
        change(a)
        expect(inspect(attest(a)).disposition).eq('indeterminate')
      }
    })

    it('preserves incomplete terminal after later settlement and avoids automatic regrading', () => {
      const a = outcome(attempt(), 'incomplete')
      a.settlement = {capturedAt: 'later', confirmedStopped: true, source: 'external-stop'}
      expect(inspect(attest(a)).disposition).eq('indeterminate')
      expect(inspect(a).attempt.runtime!.outcome).eq('incomplete')
    })

    it('retains configuration drift in the denominator without comparative claims', () => {
      const p = plan()
      const a = attempt()
      a.configuration!.privateConfiguration = 'changed'
      const result = compare(p, [report(p, [attest(a)])])
      expect(result.variants[0]).include({comparable: false, passes: 1, planned: 1})
    })

    it('imports identical reports idempotently and rejects identity/digest conflicts', () => {
      const p = plan()
      const r = report(p, [attempt()])
      expect(compare(p, [r, r]).rows.length).eq(1)
      const changed = report(p, [])
      expect(() => compare(p, [r, changed])).throw('Conflicting')
      expect(() => compare(p, [{...r, digest: '0'.repeat(64)}])).throw('digest')
      expect(() => compare({...p, suiteRevision: 'other'}, [r])).throw('plan')
    })

    it('rejects cross-slot Run/request/storage reuse and attempt aliases', () => {
      const p = plan(2)
      for (const field of ['identity', 'id'] as const) {
        const first = attempt(0)
        const second = attempt(1)
        if (field === 'identity') second.identity = first.identity
        else second.id = first.id
        expect(() => compare(p, [report(p, [first, second])])).throw()
      }
    })

    it('requires complete revision history and selects exactly one immutable correction', () => {
      const p = plan()
      const a = attempt()
      const first = report(p, [a])
      a.checks[0].result = 'fail'
      const corrected = report(p, [attest(a)], 'variant-0', 'correction', first.id)
      const result = compare(p, [first, corrected], [corrected.id])
      expect(result.variants[0].counts.fail).eq(1)
      expect(result.reports.length).eq(2)
      expect(() => compare(p, [corrected])).throw('history')
      expect(() => compare(p, [first, corrected])).throw('selected')
      const replaced = report(p, [outcome(attempt(), 'failed')], 'variant-0', 'replaced', first.id)
      expect(() => compare(p, [first, replaced], [replaced.id])).throw('substitutes')
    })

    it('keeps valid revision-1 reports readable under stricter application creation limits', () => {
      const p = plan(2)
      const r = report(p, [attempt(0), attempt(1)])
      const producerMaximum = 1
      expect(r.attempts.length > producerMaximum).eq(true)
      expect(compare(p, [r]).rows.length).eq(2)
    })

    it('accounts compatible resources with exact coverage and both denominators', () => {
      const p = plan(2, 2)
      const reports = p.variants.map((v, index) => {
        const a = attempt(0, index)
        a.metrics = [metric()]
        return report(p, [attest(a)], v.id)
      })
      const result = compare(p, reports)
      expect(result.metrics).length(2)
      for (const m of result.metrics) expect(m).include({compatible: true, planned: 2, samples: 1, sum: 2})
      const second = attempt(1, 1)
      second.metrics = [metric()]
      reports[1] = report(p, [attest(second)], 'variant-1')
      expect(compare(p, reports).metrics.every((m) => !m.compatible)).eq(true)
    })
    for (const kind of ['recovered', 'visit-prefix', 'diagnostic'] as const) {
      it(`does not treat ${kind} missing usage as complete measured zero`, () => {
        const p = plan()
        const a = attempt()
        const m = metric()
        m.value = 0
        m.provenance = kind
        if (kind === 'diagnostic') m.completeSource = false
        a.metrics = [m]
        const result = compare(p, [report(p, [attest(a)])])
        expect(result.rows[0].measurements[0].coverage).eq('unavailable')
        expect(result.rows[0].measurements[0].value).to.be.an('undefined')
        expect(result.metrics[0]).include({samples: 0, sum: null})
      })
    }

    it('rejects duplicate event identity, fractional counts and numeric overflow', () => {
      const p = plan(2)
      const a = attempt()
      a.metrics = [metric()]
      a.metrics[0].sourceIds = ['same', 'same']
      expect(() => compare(p, [report(p, [attest(a)])])).throw('Duplicate')
      a.metrics[0].sourceIds = ['one']
      a.metrics[0].value = 0.5
      expect(() => compare(p, [report(p, [attest(a)])])).throw('integers')
      a.metrics[0].value = Number.MAX_SAFE_INTEGER
      const b = attempt(1)
      b.metrics = [{...metric(), source: 'second-snapshot'}]
      expect(() => compare(p, [report(p, [attest(a), attest(b)])])).throw('overflow')
    })

    it('keeps partial, unavailable and absent measurements out of complete sums', () => {
      const p = plan()
      const a = attempt()
      const m = metric()
      m.coverage = 'partial'
      m.lowerBound = true
      a.metrics = [m]
      let result = compare(p, [report(p, [attest(a)])])
      expect(result.rows[0].measurements[0].value).eq(2)
      expect(result.metrics[0].sum).eq(null)
      a.metrics = []
      result = compare(p, [report(p, [attest(a)])])
      expect(result.metrics).deep.eq([])
    })

    it('requires monotonic approval-inclusive duration and dated cost provenance', () => {
      const p = plan()
      const a = attempt()
      const m = metric()
      m.unit = 'millisecond'
      m.scope = 'dispatch-to-quiescence'
      m.provenance = 'monotonic'
      m.clockEpoch = 'clock-1'
      a.metrics = [m]
      expect(compare(p, [report(p, [attest(a)])]).rows[0].measurements[0].coverage).eq('unavailable')
      m.includesApproval = true
      expect(compare(p, [report(p, [attest(a)])]).rows[0].measurements[0].coverage).eq('complete')
      m.unit = 'currency'
      m.scope = 'billing'
      m.provenance = 'rate-estimate'
      expect(compare(p, [report(p, [attest(a)])]).rows[0].measurements[0].coverage).eq('unavailable')
    })
  })

  describe('evaluation comparison boundaries', () => {
    it('rejects ambiguous storage namespace aliases', () => {
      const p = plan(2)
      const a = attempt(0)
      const b = attempt(1)
      b.identity!.storageIdentity = a.identity!.storageIdentity
      expect(() => compare(p, [report(p, [a, b])])).throw('namespace')
    })

    it('requires evidence scope and storage capability specified before dispatch', () => {
      const p = plan()
      const a = attempt()
      a.evidence[0].scope = 'partial-request'
      expect(inspect(a, p).disposition).eq('indeterminate')
      p.cases[0].recording = {level: 'file-and-directory-sync', mode: 'file'}
      expect(inspect(attempt(), p).issues).include('Required recording unavailable')
    })

    it('rejects repeated source events across slots while preserving separate token subsets', () => {
      const p = plan(2)
      const a = attempt(0)
      const b = attempt(1)
      a.metrics = [metric()]
      b.metrics = [metric()]
      expect(() => compare(p, [report(p, [attest(a), attest(b)])])).throw('multiple slots')
      a.metrics = [
        {
          ...metric(),
          cells: ['input'],
          id: 'input',
          resource: 'inputTokens',
          scope: 'provider-input',
          unit: 'token',
          value: 10,
        },
        {
          ...metric(),
          cells: ['cached-input'],
          id: 'cached',
          resource: 'cachedInputTokens',
          scope: 'subset-of-input',
          unit: 'token',
          value: 4,
        },
      ]
      const result = compare(p, [report(p, [attest(a)])])
      expect(result.metrics).length(2)
      expect(result.metrics.map((m) => m.sum).sort((a, b) => a! - b!)).deep.eq([4, 10])
      expect(result.metrics.map((m) => m.definition.scope)).include('subset-of-input')
    })

    it('does not sum normal, summary and nested Run/visit scopes together', () => {
      const p = plan()
      const a = attempt()
      a.metrics = [
        {...metric(), id: 'all'},
        {...metric(), cells: ['summary'], id: 'summary', scope: 'summary-only', value: 1},
        {...metric(), cells: ['normal'], id: 'visit', scope: 'visit-1', value: 1},
      ]
      const result = compare(p, [report(p, [attest(a)])])
      expect(result.metrics).length(3)
      expect(result.metrics.map((m) => m.sum)).deep.eq([2, 1, 1])
    })

    it('rejects complete duplicate aliases and suppresses resource comparisons under configuration drift', () => {
      const p = plan()
      const a = attempt()
      a.metrics = [metric(), {...metric(), id: 'alias'}]
      expect(() => compare(p, [report(p, [attest(a)])])).throw('Duplicate complete measurement')
      a.metrics.pop()
      a.configuration!.model = 'different-model'
      expect(compare(p, [report(p, [attest(a)])]).metrics[0].compatible).eq(false)
    })

    it('keeps censored time and uses declared fixed precision for currency estimates', () => {
      const p = plan()
      const a = attempt()
      const m = metric()
      Object.assign(m, {
        clockEpoch: 'one-clock',
        coverage: 'partial',
        includesApproval: true,
        lowerBound: true,
        provenance: 'monotonic',
        scope: 'dispatch-to-quiescence',
        unit: 'millisecond',
      })
      a.quiescent = false
      a.metrics = [m]
      let result = compare(p, [report(p, [attest(a)])])
      expect(result.rows[0].measurements[0]).include({coverage: 'partial', lowerBound: true, value: 2})
      expect(result.metrics[0].sum).eq(null)
      a.quiescent = true
      Object.assign(m, {
        coverage: 'complete',
        currency: 'USD',
        lowerBound: false,
        modelVersion: 'fixed-1',
        provenance: 'rate-estimate',
        rateDate: '2026-09-13',
        rateRevision: 'rates-1',
        rounding: 'half-up-6-decimals',
        scope: 'billing',
        unit: 'currency',
        value: 0.123_456_7,
      })
      result = compare(p, [report(p, [attest(a)])])
      expect(result.metrics[0].sum).eq(0.123_457)
    })

    it('requires supplied evidence again after artifact loss without rewriting history', () => {
      const p = plan()
      const first = report(p, [attempt()])
      const a = attempt()
      a.artifact = null
      const revised = report(p, [attest(a)], 'variant-0', 'lost-artifact', first.id)
      expect(compare(p, [first]).rows[0].disposition).eq('pass')
      expect(compare(p, [first, revised], [revised.id]).rows[0].disposition).eq('indeterminate')
    })
  })

  describe('evaluation numeric and schedule limits', () => {
    it('does not round a fractional count or underflow into a measured zero', () => {
      expect(() => evaluationDigest('1e-400')).throw()
      expect(() => evaluationDigest('1.00000000000000001')).throw()
      expect(evaluationDigest('1.000')).eq(evaluationDigest('1'))
      expect(evaluationDigest('1000000000000000000e-3')).eq(evaluationDigest('1000000000000000'))
    })

    it('accepts 1000 total planned slots and rejects a larger comparison', () => {
      expect(validateEvaluationPlan(JSON.stringify(plan(500, 2))).plan.variants).length(2)
      expect(() => validateEvaluationPlan(JSON.stringify(plan(501, 2)))).throw('planned slots')
    })
  })
})
