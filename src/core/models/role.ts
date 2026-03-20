// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

const roles = ['assistant', 'system', 'user'] as const

export type Role = (typeof roles)[number]

export function getRoles(): Role[] {
  return [...roles]
}
