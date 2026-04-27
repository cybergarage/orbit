#!/usr/bin/env node

import {readdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const args = {
    author: 'The Orbit Authors',
    baseDirs: ['src', 'test'],
    spdx: 'Apache-2.0',
    write: false,
    year: String(new Date().getFullYear()),
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]

    if (arg === '--write') {
      args.write = true
      continue
    }

    if (arg === '--year') {
      args.year = argv[index + 1] ?? args.year
      index++
      continue
    }

    if (arg === '--author') {
      args.author = argv[index + 1] ?? args.author
      index++
      continue
    }

    if (arg === '--spdx') {
      args.spdx = argv[index + 1] ?? args.spdx
      index++
      continue
    }

    if (arg === '--base') {
      const raw = argv[index + 1] ?? ''
      const dirs = raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)

      if (dirs.length > 0) {
        args.baseDirs = dirs
      }

      index++
      continue
    }
  }

  return args
}

async function collectTsFiles(dir) {
  const entries = await readdir(dir, {withFileTypes: true})
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        return collectTsFiles(fullPath)
      }

      if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        return [fullPath]
      }

      return []
    }),
  )

  return nested.flat()
}

async function directoryExists(dir) {
  try {
    await readdir(dir)
    return true
  } catch {
    return false
  }
}

function hasHeader(content) {
  const head = content.split(/\r?\n/, 12).join('\n')
  return head.includes('SPDX-License-Identifier:') || head.includes('Copyright (c)')
}

function addHeader(content, headerBlock) {
  if (content.startsWith('#!')) {
    const firstBreak = content.indexOf('\n')

    if (firstBreak === -1) {
      return `${content}\n${headerBlock}\n\n`
    }

    const shebang = content.slice(0, firstBreak + 1)
    const rest = content.slice(firstBreak + 1)
    return `${shebang}${headerBlock}\n\n${rest}`
  }

  return `${headerBlock}\n\n${content}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = process.cwd()
  const headerBlock = `// Copyright (c) ${args.year} ${args.author}\n// SPDX-License-Identifier: ${args.spdx}`

  const targetDirs = args.baseDirs.map((entry) => path.resolve(root, entry))
  const existingDirs = (await Promise.all(
    targetDirs.map(async (dir) => {
      if (await directoryExists(dir)) {
        return dir
      }

      // Ignore missing directories so the script works in partial checkouts.
      return null
    }),
  )).filter(Boolean)

  const tsFiles = (await Promise.all(existingDirs.map((dir) => collectTsFiles(dir)))).flat()

  tsFiles.sort((a, b) => a.localeCompare(b))

  const updateResults = await Promise.all(
    tsFiles.map(async (file) => {
      const current = await readFile(file, 'utf8')

      if (hasHeader(current)) {
        return null
      }

      const next = addHeader(current, headerBlock)
      const relative = path.relative(root, file)

      if (args.write) {
        await writeFile(file, next, 'utf8')
      }

      return relative
    }),
  )

  const updated = updateResults.filter(Boolean)

  if (updated.length === 0) {
    console.log('No TypeScript files required header updates.')
    return
  }

  const mode = args.write ? 'Updated' : 'Would update'
  console.log(`${mode} ${updated.length} TypeScript file(s):`)
  for (const file of updated) {
    console.log(`- ${file}`)
  }

  if (!args.write) {
    console.log('\nRun with --write to apply changes.')
  }
}

await main()
