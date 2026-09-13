// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {z} from 'zod'

import {immutable, SELECTION_FORMAT_LIMITS, selectionJSON, selectionText} from './validation.js'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(2048)
export const expectationSchema = z
  .object({
    candidate: hash,
    context: hash,
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    prepared: hash,
    projector: id,
    receipt: id,
    revision: z.literal(1),
    scope: id,
  })
  .strict()
export type WorkflowExpectation = z.infer<typeof expectationSchema>
export interface WorkflowSubmission {
  expectation: WorkflowExpectation
  input: string
}
export function parseWorkflowExpectation(value: unknown): WorkflowExpectation {
  return immutable(expectationSchema.parse(selectionText(selectionJSON(value))))
}

/** Shared projection: adding an ambient option alone never changes replay identity. */
export function encodeWorkflowSubmission(input: unknown, expectation: WorkflowExpectation): string {
  return selectionJSON(
    {
      ...(selectionText(selectionJSON(input, 1_048_576), 1_048_576) as Record<string, unknown>),
      selection: parseWorkflowExpectation(expectation),
    },
    SELECTION_FORMAT_LIMITS.submissionBytes,
  )
}

export function parseWorkflowSubmission(value: WorkflowSubmission): WorkflowSubmission {
  // The payload ceiling applies to retained input, not its escaped envelope twice.
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== 'string' ||
        !['expectation', 'input'].includes(k) ||
        !('value' in Object.getOwnPropertyDescriptor(value, k)!),
    )
  )
    throw new Error('Invalid selection envelope')
  const expectation = parseWorkflowExpectation(value.expectation)
  const parsed = selectionText(value.input, SELECTION_FORMAT_LIMITS.submissionBytes)
  if (selectionJSON(parsed, SELECTION_FORMAT_LIMITS.submissionBytes) !== value.input)
    throw new Error('Selection input must be canonical')
  return immutable({expectation, input: value.input})
}

export interface WorkflowContextProjector {
  id: string
  project(snapshot: Readonly<{catalog: unknown; declaration: unknown; skills: unknown}>): unknown
}
