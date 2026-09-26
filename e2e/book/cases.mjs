// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises'
import path from 'node:path'

export const source = {
  locale: 'en',
  repository: 'https://github.com/cybergarage/ai-coding-book-starter',
  revision: '4e9af157884ec4cfb64e464987dc8fd8e4d1007f',
}
export const caseIds = ['vibe', 'sdd', 'loop']

// The book evaluation explicitly requests the model's advertised window on the
// wire; a previous trial's loaded Ollama window must not become a hidden cap.
export function bookContextWindow(metadata) {
  const info = metadata.modelInfo
  const architecture = info?.['general.architecture']
  const window = typeof architecture === 'string' ? info[`${architecture}.context_length`] : undefined
  if (!Number.isSafeInteger(window) || window <= 0) throw new Error(`Unknown model context capacity: ${metadata.model}`)
  return window
}

const root = import.meta.dirname
const read = (name) => fs.readFile(path.join(root, name), 'utf8')

// A shared observation contract avoids prescribing an internal game-state API.
export const observation = `Evaluation instrumentation (apply equally to all styles):
Use data-testid="card" on each of the 16 card buttons, "reset" on the reset button,
"moves" on an element containing only the numeric move count, and "status" on
an element whose text is empty while playing and nonempty when complete.
Each card exposes data-state="down", "up", or "matched" and data-symbol equal to
its symbol only while up or matched (omit data-symbol while down). Keep these
attributes synchronized with the visible game. Give each card an accessible label.
Keep package.json, package-lock.json, tsconfig.json, and AGENTS.md unchanged.
Dependencies are preinstalled. Do not run npm ci or install dependencies.
Create at least one meaningful Vitest test; zero tests do not count as success.
Read AGENTS.md explicitly. Browser checks are performed separately by the host;
report them as pending, never as personally verified.`

export async function makeCase(id, {implementation = false} = {}) {
  if (!caseIds.includes(id)) throw new Error(`Unknown book case: ${id}`)
  const files = {}
  for (const name of [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'index.html',
    'src/main.ts',
    'src/style.css',
  ])
    files[name] = await read(`fixture/${name}`)
  files['AGENTS.md'] = await read('templates/AGENTS.md')
  if (id !== 'vibe') files['spec.md'] = await read('templates/common/spec.md')
  if (id === 'loop' || (id === 'sdd' && implementation)) files['test.md'] = await read('templates/common/test.md')
  if (id === 'loop') files['progress.md'] = await read('templates/common/progress.md')
  if (id === 'sdd' && implementation)
    files['spec.md'] +=
      '\n## Fixed evaluation review decisions\n\nZero tests do not satisfy completion. After completion, card selections do not change the state; reset starts a new game. Reset cancels pending mismatch timers. Browser checks remain pending for a person; automated completion does not imply browser verification.\n'
  const template = await read(
    `templates/prompts/${id === 'vibe' ? 'vibe' : id === 'sdd' ? 'spec-driven' : 'autonomous'}.md`,
  )
  const prompt = id === 'sdd' ? template.split('\n---\n')[implementation ? 1 : 0] : template
  return {
    files,
    id,
    prompt:
      prompt +
      '\n\n' +
      (id === 'sdd' && !implementation
        ? 'Read AGENTS.md. Review only; do not change any workspace files.'
        : observation),
    protectedFiles: [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'AGENTS.md',
      ...Object.keys(files).filter((name) => ['spec.md', 'test.md'].includes(name)),
    ],
  }
}

export async function checkFiles(workspace, c, review = false) {
  for (const name of review ? Object.keys(c.files) : c.protectedFiles) {
    const file = path.join(workspace, name)
    if (!(await fs.lstat(file)).isFile() || (await fs.readFile(file, 'utf8')) !== c.files[name])
      throw new Error(`Protected file changed: ${name}`)
  }

  if (review) {
    const names = await fs.readdir(workspace, {recursive: true, withFileTypes: true})
    for (const entry of names) {
      const relative = path.relative(workspace, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
      if (relative === 'node_modules') continue
      if (!entry.isDirectory() && !Object.hasOwn(c.files, relative)) throw new Error(`Review added file: ${relative}`)
    }
  }

  if (c.id === 'loop') {
    const progress = await fs.readFile(path.join(workspace, 'progress.md'), 'utf8')
    if (progress === c.files['progress.md']) throw new Error('Loop did not update progress.md')
    if (/\[x\].*(?:browser|keyboard|320 pixels)/i.test(progress))
      throw new Error('Loop claimed unperformed browser checks')
  }
}

export async function checkFilesAndGrade(workspace, c, grade) {
  let fileChecks = {status: 'passed'}
  try {
    await checkFiles(workspace, c)
  } catch (error) {
    fileChecks = {error: String(error), status: 'failed'}
  }

  return {fileChecks, grade: await grade()}
}

export function caseResolved(run, grade, fileChecks) {
  return fileChecks.status === 'passed' && grade.passed && runtimePassed(run)
}

export function runtimePassed(run) {
  return (
    run.status === 'completed' &&
    run.result?.runtime?.outcome === 'completed' &&
    Boolean(run.result.runtime.quiescence) &&
    !run.result.error &&
    !run.result.closeError
  )
}
