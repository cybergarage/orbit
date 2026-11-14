// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/** Validate the optional historical tag without selecting an alternate schema. */
export function validateMetadataRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ('version' in value && value.version !== 1))
    throw new Error('Invalid session metadata format')
}

/** Preserve extensions, omit the historical tag, and fail before replacing bounded metadata. */
export function encodeMetadataRecord(value: Record<string, unknown>): string {
  const record = {...value}
  delete record.version
  const encoded = JSON.stringify(record) + '\n'
  if (Buffer.byteLength(encoded) > 4096) throw new Error('Session metadata exceeds 4 KiB')
  return encoded
}
