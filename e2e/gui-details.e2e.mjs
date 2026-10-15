// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* global document, getComputedStyle, innerWidth */
// Build first. Install e2e/coding-workflows/browser dependencies or point
// ORBIT_PLAYWRIGHT_MODULE to an existing Playwright ES module. No live model is used.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {startDetailsFixture} from '../test/apps/gui/fixtures/details-workspace.mjs'

const {chromium} = await import(process.env.ORBIT_PLAYWRIGHT_MODULE ?? './coding-workflows/browser/node_modules/playwright/index.mjs')
const output = process.env.ORBIT_GUI_EVIDENCE ?? '/tmp/orbit-gui-details-evidence'
await fs.mkdir(output, {recursive: true})
const fixture = await startDetailsFixture()
const base = `http://${fixture.server.host}:${fixture.server.port}`
const headers = {'Content-Type': 'application/json', 'X-Orbit-Token': fixture.server.token}
const api = async (route, body, method = 'POST') => {
  const response = await fetch(base + route, {headers, method, ...(body === undefined ? {} : {body: JSON.stringify(body)})})
  const value = await response.json()
  assert(response.ok, JSON.stringify(value))
  return value
}

const poll = async (query, ready) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await query()
    if (ready(result)) return result
    await new Promise((resolve) => {setTimeout(resolve, 50)})
  }

  throw new Error('Timed out waiting for fixture state')
}

const browser = await chromium.launch({headless: true, ...(process.env.ORBIT_CHROMIUM_PATH ? {executablePath: process.env.ORBIT_CHROMIUM_PATH} : {})})
const page = await browser.newPage({viewport: {height: 900, width: 1440}})
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const completed = []
const check = (message) => {completed.push(message); console.log('PASS ' + message)}
const screenshot = (name) => page.screenshot({path: path.join(output, `${name}.png`)})
try {
  const project = await api('/api/projects', {directory: fixture.root, name: 'Synthetic project', operationId: randomUUID()})
  const thread = await api(`/api/projects/${project.id}/threads`, {operationId: randomUUID()})
  await api(`/api/threads/${thread.id}/messages`, {content: 'Review this synthetic interface.', requestId: randomUUID()})
  await poll(() => api(`/api/threads/${thread.id}`, undefined, 'GET'), (item) => Boolean(item.run?.result))
  await page.goto(`${base}/?token=${fixture.server.token}`)
  if (await page.getByRole('button', {exact: true, name: 'Synthetic project'}).getAttribute('aria-expanded') === 'false') await page.getByRole('button', {exact: true, name: 'Synthetic project'}).click()
  await page.locator('.project-sessions .session').first().click()
  await page.locator('.message.assistant').waitFor()
  assert.equal(await page.getByRole('button', {exact: true, name: 'Advanced'}).count(), 0)
  assert.equal(await page.locator('.conversation-heading .muted').textContent(), 'Synthetic project')
  assert.equal(await page.locator('.project-sessions .sidebar-session-row').evaluate((el) => getComputedStyle(el).paddingLeft), '16px')
  await page.waitForFunction(()=>[...document.querySelectorAll('img')].filter((el)=>el.getClientRects().length > 0).every((el)=>el.complete && el.naturalWidth > 0 && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0))
  const geometry = await page.locator('.message').evaluateAll((items) => items.map((el) => ({color:getComputedStyle(el).backgroundColor, right:el.getBoundingClientRect().right, role: el.className, x:el.getBoundingClientRect().x})))
  const user = geometry.find((item) => item.role.includes('user'))
  const assistant = geometry.find((item) => item.role.includes('assistant'))
  assert(user.x > assistant.x)
  assert.equal(user.color, 'rgb(34, 41, 53)')
  assert.equal(assistant.color, 'rgb(255, 255, 255)')
  await screenshot('desktop-conversation')
  check('Desktop conversation, dynamic title/project, 16px indentation and message alignment')
  await page.getByRole('button', {exact:true, name:'Details'}).click()
  for (const name of ['Conversation', 'Run settings', 'Logs']) await page.getByRole('heading', {exact:true, name}).waitFor()
  assert.equal(await page.locator('.diagnostics').evaluate((el) => getComputedStyle(el).position), 'static')
  assert.equal(await page.locator('.composer-wrap .advanced-controls').count(), 0)
  assert.equal(await page.locator('.conversation > .home-details').count(), 0)
  await screenshot('desktop-details')
  await page.getByRole('button', {exact:true, name:'Close details'}).click()
  assert.equal(await page.getByRole('button', {exact:true, name:'Details'}).evaluate((el) => el === document.activeElement), true)
  check('Docked common Details, sections, close and focus restoration')
  await page.setViewportSize({height:768,width:1024})
  await screenshot('compact-conversation')
  const compactUserBefore = await page.locator('.message.user').boundingBox()
  await page.getByRole('button', {exact:true, name:'Details'}).click()
  assert.equal(await page.locator('.diagnostics').evaluate((el) => getComputedStyle(el).position), 'fixed')
  assert(await page.locator('.details-backdrop').isVisible())
  await screenshot('compact-details-overlay')
  assert.deepEqual(await page.locator('.message.user').boundingBox(),compactUserBefore)
  await page.keyboard.press('Escape')
  await page.locator('.diagnostics').waitFor({state:'detached'})
  await page.setViewportSize({height:844,width:390})
  assert(await page.locator('.composer').isVisible())
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.getByRole('button', {exact:true, name:'Details'}).click()
  assert((await page.locator('.diagnostics').boundingBox()).width <= 326)
  await page.getByRole('button', {exact:true, name:'Close details'}).click()
  check('1024px and 390px overlays, Escape and viewport overflow')
  await page.setViewportSize({height:900,width:1440})
  const operation = async (limits) => {
    const run = await api(`/api/threads/${thread.id}/messages`, {content:'Request a synthetic operation.',requestId:randomUUID(), ...(limits ? {limits} : {})})
    const waiting = await poll(() => api(`/api/runs/${run.runId}`,undefined,'GET'), (item)=>item.approvals.length > 0)
    await page.getByRole('dialog', {name:'Confirm one operation'}).waitFor()
    return {approval:waiting.approvals[0], run}
  }

  let {run} = await operation()
  const dialog = page.getByRole('dialog', {name:'Confirm one operation'})
  await screenshot('approval-dialog')
  await page.locator('.approval-backdrop').click({position:{x:4,y:4}})
  assert(await dialog.isVisible())
  await page.keyboard.press('Tab')
  assert.equal(await dialog.locator('summary').evaluate((el)=>el === document.activeElement),true)
  await page.keyboard.press('Tab')
  assert.equal(await dialog.getByRole('button',{exact:true,name:'Close'}).evaluate((el)=>el === document.activeElement),true)
  await page.keyboard.press('Shift+Tab')
  assert.equal(await dialog.locator('summary').evaluate((el)=>el === document.activeElement),true)
  await page.keyboard.press('Shift+Tab')
  assert.equal(await dialog.getByRole('button',{exact:true,name:'Approve once'}).evaluate((el)=>el === document.activeElement),true)
  await page.keyboard.press('Escape')
  await dialog.waitFor({state:'detached'})
  assert.equal((await api(`/api/runs/${run.runId}`,undefined,'GET')).approvals.length,1)
  await page.getByRole('button',{name:'Review operation'}).click()
  await dialog.getByRole('button',{exact:true,name:'Close'}).click()
  assert.equal((await api(`/api/runs/${run.runId}`,undefined,'GET')).approvals.length,1)
  await page.getByRole('button',{name:'Review operation'}).click()
  let submissions = 0
  const count = (request) => {if(request.method()==='POST' && request.url().endsWith('/approvals')) submissions++}
  page.on('request',count)
  await dialog.getByRole('button',{exact:true,name:'Approve once'}).evaluate((el)=>{el.click();el.click()})
  await poll(() => api(`/api/runs/${run.runId}`,undefined,'GET'), (item)=>Boolean(item.result))
  await dialog.waitFor({state:'detached'})
  page.off('request',count)
  assert.equal(submissions,1)
  assert.equal(await fs.readFile(path.join(fixture.root,'synthetic-answer.txt'),'utf8'),'Synthetic approval result.')
  check('Approval backdrop/Escape/Close retain pending request, reopen, Tab trap, allow once and double-click prevention')
  await fs.rm(path.join(fixture.root,'synthetic-answer.txt'))
  ;({run} = await operation())
  await page.route('**/api/runs/*/approvals', (route)=>route.fulfill({body:JSON.stringify({error:'Synthetic decision transport failure'}),contentType:'application/json',status:503}))
  await dialog.getByRole('button',{exact:true,name:'Deny'}).click()
  await dialog.getByRole('alert').filter({hasText:'Synthetic decision transport failure'}).waitFor()
  assert.equal((await api(`/api/runs/${run.runId}`,undefined,'GET')).approvals.length,1)
  await page.unroute('**/api/runs/*/approvals')
  await dialog.getByRole('button',{exact:true,name:'Deny'}).click()
  await poll(() => api(`/api/runs/${run.runId}`,undefined,'GET'), (item)=>Boolean(item.result))
  assert.equal(await fs.stat(path.join(fixture.root,'synthetic-answer.txt')).catch(()=>null),null)
  check('Failed decision stays pending and can be retried; Deny prevents the synthetic write')
  const expiring = await operation({approvalMs:3000})
  run = expiring.run
  await page.clock.setSystemTime(expiring.approval.expiresAt + 1)
  await dialog.getByText('This request has expired.', {exact:false}).waitFor()
  assert(await dialog.getByRole('button',{exact:true,name:'Approve once'}).isDisabled())
  assert(await dialog.getByRole('button',{exact:true,name:'Deny'}).isDisabled())
  await screenshot('approval-expired')
  await page.clock.setSystemTime(Date.now())
  await poll(() => api(`/api/runs/${run.runId}`,undefined,'GET'), (item)=>Boolean(item.result))
  await dialog.waitFor({state:'detached'})
  assert.equal(await fs.stat(path.join(fixture.root,'synthetic-answer.txt')).catch(()=>null),null)
  check('Approval expiry removes the dialog and never dispatches the operation')
  const limited = await api(`/api/threads/${thread.id}/messages`, {content:'A synthetic limit check.',limits:{modelCalls:0},requestId:randomUUID()})
  await poll(() => api(`/api/runs/${limited.runId}`,undefined,'GET'), (item)=>item.result?.outcome === 'budget-exceeded')
  await page.getByRole('button',{exact:true,name:'Review limits'}).waitFor()
  assert.equal(await page.locator('.diagnostics').count(),0)
  assert(await page.getByRole('button',{exact:true,name:'Continue with next-run limits'}).isVisible())
  await page.getByRole('button',{exact:true,name:'Review limits'}).click()
  await page.getByRole('heading',{exact:true,name:'Run settings'}).waitFor()
  await page.getByRole('button',{exact:true,name:'Close details'}).click()
  check('Limit-reached status and continuation remain available with Details closed')
  await page.getByRole('button',{exact:true,name:'Session actions'}).click()
  await page.getByRole('menuitem',{exact:true,name:'Rename session…'}).click()
  const rename = page.getByRole('dialog',{name:'Rename session'})
  await rename.getByRole('textbox').fill('Synthetic renamed conversation')
  await rename.getByRole('button',{name:'Save name'}).click()
  await page.locator('.conversation-heading .title').filter({hasText:'Synthetic renamed conversation'}).waitFor()
  await page.reload()
  if (await page.getByRole('button',{exact:true,name:'Synthetic project'}).getAttribute('aria-expanded') === 'false') await page.getByRole('button',{exact:true,name:'Synthetic project'}).click()
  await page.getByRole('button',{exact:true,name:'Synthetic renamed conversation'}).click()
  await page.locator('.conversation-heading .title').filter({hasText:'Synthetic renamed conversation'}).waitFor()
  check('Rename persists across reload and history resume')
  await page.getByRole('button',{exact:true,name:'Project actions for Synthetic project'}).click()
  await page.getByRole('menuitem',{exact:true,name:'Rename project…'}).click()
  const projectRename = page.getByRole('dialog',{exact:true,name:'Rename project'})
  await projectRename.getByRole('textbox',{name:'Project name'}).fill('Synthetic renamed project')
  await projectRename.getByRole('button',{exact:true,name:'Save name'}).click()
  await page.locator('.conversation-heading .muted').filter({hasText:'Synthetic renamed project'}).waitFor()
  check('Project Rename updates the selected conversation header')
  const reconnect = fixture.disconnectStreams()
  await page.getByText('The event stream disconnected. Reconnecting…', {exact:true}).waitFor()
  await page.getByText('The event stream disconnected. Reconnecting…', {exact:true}).waitFor({state:'detached'})
  await reconnect
  assert.equal(await page.locator('.conversation-heading .title').textContent(),'Synthetic renamed conversation')
  check('Event stream disconnect/reconnect restores authoritative state and retains Rename')
  await page.getByRole('button',{exact:true,name:'Details'}).click()
  await page.getByRole('button',{exact:true,name:'Scheduled'}).click()
  await page.locator('.workspace .title').filter({hasText:'Scheduled'}).waitFor()
  assert.equal(await page.locator('main').evaluate((el)=>getComputedStyle(el).gridTemplateColumns.split(' ').length),3)
  await page.getByRole('button',{exact:true,name:'Home'}).click()
  check('Scheduled navigation and returning to conversation')
  assert.deepEqual(errors,[])
  await fs.writeFile(path.join(output,'results.json'), JSON.stringify({completed,errors},null,2))
} finally {
  await browser.close()
  await fixture.close()
}
