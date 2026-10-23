// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/** Lexical evidence of a shared subject, deliberately conservative rather than semantic truth. */
function terms(value: string): Set<string> {
  const text = value.normalize('NFKC').toLowerCase()
  const words = text.match(/[a-z0-9_]{2,}/gu) ?? []
  const stop = new Set(['and', 'are', 'for', 'from', 'into', 'that', 'the', 'this', 'was', 'will', 'with'])
  const result = new Set(words.filter((word) => !stop.has(word)))
  for (const match of text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu)) {
    const chars = [...match[0]]
    for (let index = 0; index + 1 < chars.length; index++) result.add(chars[index] + chars[index + 1])
  }

  return result
}

export function knowledgeOverlap(left: string, right: string): number {
  const a = terms(left)
  return [...terms(right)].filter((term) => a.has(term)).length
}
