// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export const cases = [
  {
    expectedAnswer: 'orbit-e2e-north-7391',
    files: {'settings.json': JSON.stringify({deployment: {region: 'orbit-e2e-north-7391'}})},
    id: 'read',
    prompt: 'Read settings.json and report the deployment region exactly. Do not modify any files.',
  },
  {
    files: {'math.cjs': 'exports.add = (a, b) => a - b;\n'},
    grader:
      "const {add}=require('/workspace/math.cjs'); for(const [a,b] of [[2,3],[-5,2],[0,0],[1.5,2.25]]) assert.equal(add(a,b),a+b);",
    id: 'single-file',
    prompt:
      'Fix add(a, b) in math.cjs so it adds two numbers. Check your change by running Node.js. Preserve the CommonJS API.',
  },
  {
    files: {
      'math.cjs': 'exports.sum = values => values.reduce((a, b) => a + b);\n',
      'test.cjs':
        "const assert=require('node:assert/strict'); const {sum}=require('./math.cjs'); assert.equal(sum([]),0); assert.equal(sum([2,3]),5); console.log('PASS');\n",
    },
    grader:
      "const {sum}=require('/workspace/math.cjs'); assert.equal(sum([]),0); assert.equal(sum([1,2,3]),6); assert.equal(sum([-2,2]),0);",
    id: 'test-repair',
    prompt:
      'First run node test.cjs to observe the failure before editing. Then fix math.cjs and rerun node test.cjs. Do not edit test.cjs. Preserve the CommonJS API.',
    protectedFiles: ['test.cjs'],
    recovery: true,
  },
  {
    files: {
      'invoice.cjs':
        "const {totalCents}=require('./price.cjs'); exports.invoice=(priceCents,quantity)=>'$'+totalCents(priceCents,quantity);\n",
      'price.cjs': 'exports.totalCents = (priceCents, quantity) => priceCents + quantity;\n',
    },
    grader:
      "const {totalCents}=require('/workspace/price.cjs'); const {invoice}=require('/workspace/invoice.cjs'); for(const [p,q] of [[125,2],[0,3],[99,7],[10,0]]) {assert.equal(totalCents(p,q),p*q); assert.equal(invoice(p,q),'$'+(p*q/100).toFixed(2));}",
    id: 'multi-file',
    prompt:
      'Fix price.cjs and invoice.cjs: totalCents(priceCents, quantity) must multiply unit price in cents by quantity. invoice must return dollars with a $ prefix and exactly two decimals (e.g. invoice(125,2) returns $2.50). Test both APIs using Node.js. Preserve the CommonJS exports.',
  },
]

export function recoveryObserved(entries) {
  const tools = entries.filter((e) => e.type === 'message' && e.message.type === 'tool').map((e) => e.message.payload)
  let failed = false
  for (const tool of tools) {
    if (tool.name !== 'bash' || !tool.input?.command?.includes('node test.cjs')) continue
    const exit = tool.output?.details?.exitCode
    const details = tool.output?.details ?? {}
    const fixtureFailure = (details.stderr ?? '').includes('TypeError: Reduce of empty array with no initial value')
    if ((typeof exit === 'number' && exit !== 0) || fixtureFailure) failed = true
    else if (failed && exit === 0 && !tool.isError && (details.stdout ?? '').includes('PASS')) return true
  }

  return false
}
