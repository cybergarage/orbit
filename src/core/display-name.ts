// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {z} from 'zod'

export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u)
