// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import process from 'node:process'
import readline from 'node:readline'

import type {Project} from '../core/index.js'

export async function confirmProjectDeletion(project: Project): Promise<boolean> {
  if (!process.stdin.isTTY)
    throw new Error('Project deletion requires confirmation. Re-run with --force in non-interactive mode.')
  const terminal = readline.createInterface({input: process.stdin, output: process.stderr})
  try {
    const answer = await new Promise<string>((resolve) => {
      terminal.once('close', () => resolve(''))
      terminal.once('SIGINT', () => resolve(''))
      terminal.question(
        `Permanently delete project ${JSON.stringify(project.name)} (${project.id}) and its project memories? ` +
          'Remaining conversations prevent deletion. Working-directory files are preserved. [y/N] ',
        resolve,
      )
    })
    return /^(?:y|yes)$/iu.test(answer.trim())
  } finally {
    terminal.close()
  }
}
