// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

export const Role = {
  Assistant: 'assistant',
  Developer: 'developer',
  System: 'system',
  User: 'user',
} as const

export type Role = (typeof Role)[keyof typeof Role]

export function getRoles(): Role[] {
  return Object.values(Role) as Role[]
}
