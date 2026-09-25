// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint unicorn/prefer-dom-node-dataset: off -- These are Playwright locators, not DOM nodes. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import fs from 'node:fs/promises'
// Installed only in the separate browser grader image.
// eslint-disable-next-line import/no-unresolved
import {chromium} from 'playwright'

// The host mounts only the final artifact, never the solver's node_modules.
for (const entry of await fs.readdir('/artifact')) {
  if (entry !== 'node_modules' && entry !== 'dist')
    await fs.cp(`/artifact/${entry}`, `/workspace/${entry}`, {recursive: true, verbatimSymlinks: true})
}

await fs.symlink('/opt/book/node_modules', '/workspace/node_modules')
const execute = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn('node', args, {stdio: 'inherit'})
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Check failed (${code}): ${args.join(' ')}`)),
    )
  })
await execute(['/opt/book/node_modules/typescript/bin/tsc', '--noEmit'])
await execute([
  '/opt/book/node_modules/vitest/vitest.mjs',
  'run',
  '--passWithNoTests=false',
  '--reporter=json',
  '--outputFile=/workspace/test-result.json',
])
const tests = JSON.parse(await fs.readFile('/workspace/test-result.json', 'utf8'))
assert.ok(tests.numPassedTests > 0 && tests.numFailedTests === 0 && tests.success, 'At least one test must pass')
await execute(['/opt/book/node_modules/vite/bin/vite.js', 'build'])
const server = spawn(
  'node',
  ['/opt/book/node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
  {stdio: 'inherit'},
)
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:4173')).ok) break
    } catch {
      /* Wait for the local preview server. */
    }

    if (attempt === 100) throw new Error('Preview server did not start')
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })
  }

  browser = await chromium.launch({args: ['--no-sandbox'], headless: true})
  const page = await browser.newPage({viewport: {height: 700, width: 320}})
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.clock.install({time: new Date('2025-01-01T00:00:00Z')})
  await page.clock.pauseAt(new Date('2025-01-01T00:00:10Z'))
  await page.goto('http://127.0.0.1:4173')
  const cards = page.getByTestId('card')
  const card = (index) => cards.nth(index)
  const state = (index) => card(index).getAttribute('data-state')
  const symbol = (index) => card(index).getAttribute('data-symbol')
  const moves = async () => Number(await page.getByTestId('moves').textContent())
  const click = (index) => card(index).dispatchEvent('click')
  assert.equal(await cards.count(), 16, 'Expected 16 cards')
  assert.equal(await moves(), 0)
  assert.equal((await page.getByTestId('status').textContent()).trim(), '')
  const bounds = []
  for (let index = 0; index < 16; index++) {
    assert.equal(await card(index).evaluate((el) => el.tagName), 'BUTTON')
    assert.equal(await state(index), 'down')
    assert.equal(await symbol(index), null)
    assert.ok(await card(index).getAttribute('aria-label'), 'Card needs an accessible label')
    bounds.push(await card(index).boundingBox())
  }

  assert.ok(bounds.every(Boolean), 'Cards must be visible')
  assert.equal(new Set(bounds.map((box) => Math.round(box.x))).size, 4)
  assert.equal(new Set(bounds.map((box) => Math.round(box.y))).size, 4)
  // eslint-disable-next-line no-undef -- executed in the browser
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px layout overflows')
  await card(0).focus()
  await page.keyboard.press('Enter')
  assert.equal(await state(0), 'up', 'Keyboard selection')
  assert.equal(await moves(), 0)
  await click(0)
  assert.equal(await moves(), 0, 'Repeated selection')
  const symbols = []
  let mismatchChecked = false
  for (let index = 0; index < 16; index += 2) {
    if (index !== 0) await click(index)
    symbols[index] = await symbol(index)
    assert.ok(symbols[index])
    await click(index + 1)
    symbols[index + 1] = await symbol(index + 1)
    assert.ok(symbols[index + 1])
    assert.equal(await moves(), index / 2 + 1)
    if (symbols[index] === symbols[index + 1]) {
      assert.equal(await state(index), 'matched')
      assert.equal(await state(index + 1), 'matched')
    } else {
      mismatchChecked = true
      const third = (index + 2) % 16
      const previous = await state(third)
      await click(third)
      assert.equal(await state(third), previous, 'Input must be locked')
      await page.clock.runFor(799)
      assert.equal(await state(index), 'up', 'Mismatch must remain visible at 799ms')
      await page.clock.runFor(1)
      assert.equal(await state(index), 'down', 'Mismatch must hide at 800ms')
      assert.equal(await state(index + 1), 'down')
      assert.equal(await symbol(index), null)
    }
  }

  assert.equal(new Set(symbols).size, 8)
  for (const value of new Set(symbols)) {
    const indexes = symbols.flatMap((item, index) => (item === value ? [index] : []))
    assert.equal(indexes.length, 2)
    if ((await state(indexes[0])) !== 'matched') {
      await click(indexes[0])
      await click(indexes[1])
    }

    assert.equal(await state(indexes[0]), 'matched')
    assert.equal(await state(indexes[1]), 'matched')
  }

  assert.ok((await page.getByTestId('status').textContent()).trim())
  const finalMoves = await moves()
  await click(0)
  assert.equal(await moves(), finalMoves)
  await page.getByTestId('reset').click()
  assert.equal(await moves(), 0)
  assert.equal((await page.getByTestId('status').textContent()).trim(), '')
  for (let index = 0; index < 16; index++) assert.equal(await state(index), 'down')
  // Reset during a pending mismatch must not flip the new game's first card.
  let resetTimerChecked = false
  for (let attempt = 0; attempt < 16; attempt++) {
    await click(0)
    const first = await symbol(0)
    await click(1)
    if ((await symbol(1)) !== first) {
      await page.getByTestId('reset').click()
      await click(0)
      await page.clock.runFor(800)
      assert.equal(await state(0), 'up', 'Reset must cancel the previous mismatch timer')
      resetTimerChecked = true
      break
    }

    await page.getByTestId('reset').click()
  }

  assert.ok(mismatchChecked, 'Mismatch coverage was not exercised')
  assert.ok(resetTimerChecked, 'Reset timer coverage was not exercised')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({browserPassed: true, mismatchChecked, resetTimerChecked, tests: tests.numPassedTests}))
  console.log(process.env.ORBIT_BOOK_MARKER)
} finally {
  await browser?.close()
  server.kill('SIGKILL')
}
