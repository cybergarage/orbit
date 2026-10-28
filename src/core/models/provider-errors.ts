// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/** Authentication messages can echo key fragments. Retain no raw provider error or cause. */
export function redactProviderAuthenticationError(error: unknown, provider: string): unknown {
  const details = error && typeof error === 'object' ? (error as {name?: string; status?: number}) : undefined
  if (
    details?.status !== 401 &&
    details?.status !== 403 &&
    details?.name !== 'AuthenticationError' &&
    details?.name !== 'PermissionDeniedError'
  )
    return error
  return Object.assign(new Error(`${provider} authentication was rejected; check host credentials`), {
    name: 'ModelAuthenticationError',
    status: details.status,
  })
}
