// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises'
await fs.symlink('/opt/book/node_modules', '/workspace/node_modules')
await import('../worker.mjs')
