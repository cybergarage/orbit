// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// The browser bundle is a development-time artifact produced before packaging.
// eslint-disable-next-line n/no-unpublished-import
import {build} from 'esbuild'

await build({
  bundle: true,
  entryPoints: ['src/apps/gui/client.tsx'],
  format: 'esm',
  logLevel: 'info',
  minify: true,
  outfile: 'dist/apps/gui/public/client.js',
  platform: 'browser',
  sourcemap: true,
  target: ['es2022'],
})
