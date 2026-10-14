// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// The browser bundle is a development-time artifact produced before packaging.
import {build} from 'esbuild'
import {copyFile, mkdir, readdir} from 'node:fs/promises'

await build({
  bundle: true,
  entryPoints: ['src/apps/gui/client.tsx'],
  format: 'esm',
  loader: {'.png': 'dataurl', '.svg': 'dataurl'},
  logLevel: 'info',
  minify: true,
  outfile: 'dist/apps/gui/public/client.js',
  platform: 'browser',
  sourcemap: true,
  target: ['es2022'],
})

await mkdir('dist/apps/gui/public/assets', {recursive: true})
await Promise.all(
  (await readdir('src/apps/gui/public/assets')).map((name) =>
    copyFile(`src/apps/gui/public/assets/${name}`, `dist/apps/gui/public/assets/${name}`),
  ),
)
