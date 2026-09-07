// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import express, {type ErrorRequestHandler, type NextFunction, type Request, type Response} from 'express'
import {randomBytes, timingSafeEqual} from 'node:crypto'
import {createServer, type Server} from 'node:http'
import {fileURLToPath} from 'node:url'
import {z} from 'zod'

import type {DiagnosticEvent, LogRecord, OrbitApplicationService} from '../../core/index.js'

import {ExecutionRequestError} from '../../core/execution/run.js'
import {DiagnosticCapture, InvalidInputError} from '../../core/index.js'

export interface GuiServerOptions {
  clientBundle?: string
  host?: string
  port?: number
  service: OrbitApplicationService
  token?: string
}

export interface GuiServer {
  close(): Promise<void>
  host: string
  port: number
  token: string
  url: string
}

const messageSchema = z.object({content: z.string().trim().min(1)})
const logQuerySchema = z.object({
  after: z.string().min(1).max(1024).optional(),
  category: z.enum(['lifecycle', 'mcp', 'model', 'runtime', 'security', 'storage', 'tool']).optional(),
  eventType: z.string().min(1).max(120).optional(),
  level: z.enum(['debug', 'error', 'fatal', 'info', 'trace', 'warn']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  outcome: z.enum(['cancelled', 'denied', 'failed', 'started', 'succeeded']).optional(),
  search: z.string().max(200).optional(),
})
const preferencesSchema = z
  .object({
    debugPanelVisible: z.boolean().optional(),
    diagnosticCapture: z.enum([DiagnosticCapture.Full, DiagnosticCapture.Metadata, DiagnosticCapture.Off]).optional(),
  })
  .strict()

export async function startGuiServer(options: GuiServerOptions): Promise<GuiServer> {
  const host = options.host ?? '127.0.0.1'
  if (!isLoopbackHost(host)) throw new Error('The Orbit GUI server may only listen on a loopback address.')

  const token = options.token ?? randomBytes(32).toString('base64url')
  const app = express()
  app.disable('x-powered-by')
  app.use(securityHeaders)
  app.use(rejectUnexpectedOrigin)
  app.use(express.json({limit: '1mb'}))

  app.get('/', requireToken(token), (_request, response) => {
    response.type('html').send(renderIndexHtml(token))
  })
  app.get('/client.js', requireToken(token), (_request, response, next) => {
    const clientBundle = options.clientBundle ?? fileURLToPath(new URL('public/client.js', import.meta.url))
    response.sendFile(clientBundle, (error) => {
      if (error !== undefined) next(error)
    })
  })

  app.use('/api', requireToken(token))
  app.get('/api/runtime', (_request, response) => response.json(options.service.runtime))
  app.get('/api/logs/health', (_request, response) => response.json(options.service.getLogHealth()))
  app.get('/api/preferences', (_request, response) => response.json(options.service.getPreferences()))
  app.patch('/api/preferences', (request, response) => {
    response.json(options.service.updatePreferences(preferencesSchema.parse(request.body)))
  })
  app.get('/api/sessions', async (request, response) => {
    const cursor = stringQuery(request.query.cursor)
    const limitValue = stringQuery(request.query.limit)
    const limit = limitValue === undefined ? undefined : Number(limitValue)
    response.json(await options.service.listSessions({cursor, limit}))
  })
  app.get('/api/sessions/:sessionId/logs', async (request, response) => {
    const query = logQuerySchema.parse(request.query)
    const page = await options.service.getSessionLogs(request.params.sessionId, {
      ...(query.after === undefined ? {} : {after: query.after}),
      ...(query.category === undefined ? {} : {categories: [query.category]}),
      ...(query.eventType === undefined ? {} : {eventTypes: [query.eventType]}),
      ...(query.level === undefined ? {} : {levels: [query.level]}),
      ...(query.limit === undefined ? {} : {limit: query.limit}),
      ...(query.outcome === undefined ? {} : {outcomes: [query.outcome]}),
      ...(query.search === undefined ? {} : {search: query.search}),
    })
    if (page === undefined) return response.status(404).json({error: 'Session not found.'})
    return response.json(page)
  })
  app.delete('/api/sessions/:sessionId', async (request, response) => {
    const deleted = await options.service.deleteSession(request.params.sessionId)
    response.status(deleted ? 200 : 404).json({deleted, id: request.params.sessionId})
  })
  app.post('/api/threads', (_request, response) => response.status(201).json(options.service.createThread()))
  app.post('/api/sessions/:sessionId/resume', async (request, response) => {
    response.json(await options.service.resumeSession(request.params.sessionId))
  })
  app.get('/api/threads/:threadId', (request, response) => {
    const thread = options.service.getThread(request.params.threadId)
    if (thread === undefined) return response.status(404).json({error: 'Thread not found.'})
    return response.json(thread)
  })
  app.post('/api/threads/:threadId/messages', async (request, response) => {
    const {content} = messageSchema.parse(request.body)
    const requestId = content.startsWith('/')
      ? undefined
      : z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,160}$/u)
          .parse(request.body.requestId)
    response.status(202).json(await options.service.startRun(request.params.threadId, content, requestId))
  })
  app.get('/api/runs/:runId', async (request, response) => {
    const snapshot = await options.service.queryRun(request.params.runId)
    if (!snapshot) {
      response.status(404).json({error: 'Unknown run'})
      return
    }

    response.json(snapshot)
  })
  app.post('/api/runs/:runId/approvals', async (request, response) => {
    const reply = z
      .object({approve: z.boolean(), digest: z.string().length(64), requestId: z.string().min(1).max(160)})
      .strict()
      .parse(request.body)
    response.json({status: await options.service.replyApproval(request.params.runId, reply)})
  })
  app.post('/api/runs/:runId/cancel', (request, response) => {
    const cancelled = options.service.cancelRun(request.params.runId)
    const snapshot = options.service.getRun(request.params.runId)
    response
      .status(cancelled ? 202 : snapshot ? 200 : 404)
      .json({cancelled, status: cancelled ? 'requested' : snapshot?.result ? 'already-terminal' : 'unknown'})
  })
  app.get('/api/events', (request, response) => streamEvents(request, response, options.service))

  app.use(((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error.'
    response
      .status(
        error instanceof z.ZodError
          ? 400
          : error instanceof ExecutionRequestError || error instanceof InvalidInputError
            ? 409
            : 500,
      )
      .json({error: message})
  }) satisfies ErrorRequestHandler)

  const server = createServer(app)
  await listen(server, options.port ?? 0, host)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Orbit GUI server did not bind to a TCP port.')
  const {port} = address
  return {
    close: () => closeServer(server),
    host,
    port,
    token,
    url: `http://${host}:${port}/?token=${encodeURIComponent(token)}`,
  }
}

function streamEvents(request: Request, response: Response, service: OrbitApplicationService): void {
  response.status(200)
  response.set({
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
  })
  response.flushHeaders()

  const lastEventId = Number(request.get('last-event-id') ?? request.query.after ?? 0)
  const afterSequence = Number.isSafeInteger(lastEventId) && lastEventId >= 0 ? lastEventId : 0
  for (const event of service.getEvents(afterSequence)) writeEvent(response, event)
  const unsubscribeRuns = service.subscribeRunSnapshots((snapshot) =>
    response.write(`event: run-snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`),
  )
  const unsubscribeDiagnostics = service.subscribe((event) => writeEvent(response, event))
  const unsubscribeLogs = service.subscribeLogs((record) => writeLogRecord(response, record))
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000)
  request.once('close', () => {
    clearInterval(heartbeat)
    unsubscribeRuns()
    unsubscribeDiagnostics()
    unsubscribeLogs()
  })
}

function writeEvent(response: Response, event: DiagnosticEvent): void {
  response.write(`id: ${event.sequence}\nevent: diagnostic\ndata: ${JSON.stringify(event)}\n\n`)
}

function writeLogRecord(response: Response, record: LogRecord): void {
  response.write(`event: log\ndata: ${JSON.stringify(record)}\n\n`)
}

function requireToken(expected: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const supplied = request.get('x-orbit-token') ?? stringQuery(request.query.token)
    if (supplied === undefined || !safeTokenEqual(expected, supplied)) {
      response.status(403).json({error: 'Invalid Orbit GUI capability token.'})
      return
    }

    next()
  }
}

function safeTokenEqual(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const suppliedBuffer = Buffer.from(supplied)
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer)
}

function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.set({
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  next()
}

function rejectUnexpectedOrigin(request: Request, response: Response, next: NextFunction): void {
  const origin = request.get('origin')
  if (origin === undefined) return next()
  try {
    const url = new URL(origin)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname)) return next()
  } catch {}

  response.status(403).json({error: 'Unexpected request origin.'})
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
    server.closeAllConnections()
  })
}

function renderIndexHtml(token: string): string {
  const clientUrl = `/client.js?token=${encodeURIComponent(token)}`
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="orbit-token" content="${escapeHtml(token)}">
  <title>Orbit</title>
  <style>${GUI_STYLES}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${clientUrl}"></script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

const GUI_STYLES = `
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0b0d10; color:#e8e9eb; }
* { box-sizing:border-box; }
body { margin:0; min-width:860px; min-height:100vh; overflow:hidden; }
button, textarea, select { font:inherit; }
button { color:inherit; cursor:pointer; }
.app { display:grid; grid-template-columns:260px minmax(420px,1fr) minmax(320px,38vw); height:100vh; background:#111419; }
.app.debug-hidden { grid-template-columns:260px minmax(420px,1fr); }
.pane { min-width:0; min-height:0; border-right:1px solid #292d35; }
.sidebar { display:flex; flex-direction:column; background:#15181e; padding:14px 10px; }
.brand { display:flex; align-items:center; gap:10px; padding:4px 8px 15px; font-weight:700; letter-spacing:.04em; }
.brand-mark { display:grid; place-items:center; width:28px; height:28px; border-radius:9px; background:linear-gradient(145deg,#87d7ff,#7c6cff); color:#071018; }
.primary { border:1px solid #414958; border-radius:9px; background:#252a34; padding:10px 12px; text-align:left; }
.primary:hover { background:#303744; }
.section-title { margin:20px 8px 8px; color:#9198a6; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
.sessions { flex:1; overflow:auto; }
.session { width:100%; border:0; border-radius:8px; background:transparent; padding:9px; text-align:left; }
.session:hover, .session.active { background:#252a33; }
.session-title { display:block; overflow:hidden; color:#e6e8eb; font-size:13px; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
.session-meta { display:block; margin-top:4px; overflow:hidden; color:#858d9b; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
.context-menu { position:fixed; z-index:10; min-width:196px; border:1px solid #3a414d; border-radius:8px; background:#20242b; padding:5px; box-shadow:0 12px 32px #0009; }
.context-menu button { width:100%; border:0; border-radius:5px; background:transparent; padding:8px 10px; text-align:left; }
.context-menu button:hover { background:#343942; }
.context-menu .context-menu-danger { color:#ff8c94; }
.context-menu-separator { height:1px; margin:5px 4px; background:#3a414d; }
.dialog-backdrop { position:fixed; inset:0; z-index:20; display:grid; place-items:center; background:#0009; }
.dialog { width:min(420px,calc(100vw - 32px)); border:1px solid #424955; border-radius:12px; background:#20242b; padding:20px; box-shadow:0 18px 60px #000b; }
.dialog h2 { margin:0 0 10px; font-size:17px; }
.dialog p { margin:0 0 14px; color:#abb2bd; font-size:13px; line-height:1.45; }
.dialog-session { overflow:hidden; border-radius:7px; background:#171a20; padding:9px 10px; color:#d8dbe0; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.dialog-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }
.dialog-actions button { border:1px solid #444b57; border-radius:7px; background:#2b3038; padding:7px 13px; }
.dialog-actions button:hover { background:#353b45; }
.dialog-actions .danger { border-color:#9d4149; background:#8b343c; color:white; }
.dialog-actions .danger:hover { background:#a43e48; }
.session-details { width:min(620px,calc(100vw - 32px)); }
.session-id-row { display:flex; align-items:center; gap:8px; border-radius:7px; background:#171a20; padding:9px 10px; }
.session-id-row code { flex:1; overflow:auto; color:#d8dbe0; font-size:12px; user-select:text; white-space:nowrap; }
.session-id-row button { border:1px solid #444b57; border-radius:6px; background:#2b3038; padding:5px 9px; white-space:nowrap; }
.session-details dl { margin:14px 0 0; }
.session-detail { display:grid; grid-template-columns:135px minmax(0,1fr); gap:12px; border-top:1px solid #303641; padding:9px 0; font-size:12px; }
.session-detail dt { color:#8f98a6; }
.session-detail dd { margin:0; overflow-wrap:anywhere; color:#d8dbe0; user-select:text; }
.sidebar-footer { border-top:1px solid #292d35; padding:12px 6px 0; color:#a9afba; font-size:12px; }
.toggle-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.conversation { display:flex; flex-direction:column; background:#111419; }
.topbar { display:flex; align-items:center; justify-content:space-between; min-height:54px; border-bottom:1px solid #292d35; padding:9px 18px; }
.title { min-width:0; font-size:14px; font-weight:650; }
.topbar-actions { display:flex; align-items:center; gap:7px; }
.badge { border:1px solid #343b47; border-radius:999px; padding:4px 8px; color:#aab1bd; font-size:11px; }
.icon-button { display:grid; width:30px; height:30px; place-items:center; border:1px solid #343b47; border-radius:8px; background:#1a1e25; color:#aab1bd; font-size:18px; line-height:1; }
.icon-button:hover { background:#292f39; color:#eef0f2; }
.messages { flex:1; overflow:auto; padding:28px max(22px,8%); }
.empty { display:grid; height:100%; place-items:center; color:#858d99; text-align:center; }
.message { margin:0 auto 22px; max-width:860px; }
.message-label { margin-bottom:7px; color:#858d99; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
.message-body { line-height:1.58; overflow-wrap:anywhere; white-space:pre-wrap; }
.message.user .message-body { display:inline-block; border-radius:14px 14px 4px 14px; background:#262c36; padding:10px 14px; }
.run-status { margin:0 auto 22px; max-width:860px; color:#c5cbd4; }
.run-status-body { display:flex; align-items:center; gap:9px; min-height:24px; line-height:1.5; }
.run-status-dot { width:8px; height:8px; flex:0 0 auto; border-radius:50%; background:#87d7ff; animation:run-status-pulse 1.4s ease-in-out infinite; }
.run-status.cancelled { color:#969eaa; }
.run-status.failed { color:#ff9da4; }
@keyframes run-status-pulse { 0%,100% { opacity:.35; transform:scale(.82); } 50% { opacity:1; transform:scale(1); } }
.tool-card { margin-top:9px; border:1px solid #303743; border-radius:8px; background:#15191f; }
.tool-card summary { cursor:pointer; padding:8px 10px; color:#b5bdc9; font-size:12px; }
.tool-card pre { margin:0; border-top:1px solid #303743; padding:10px; overflow:auto; color:#a8d5ba; font-size:11px; white-space:pre-wrap; }
.composer-wrap { padding:12px max(18px,7%) 18px; }
.composer { margin:auto; max-width:900px; border:1px solid #3a424f; border-radius:14px; background:#1a1e25; box-shadow:0 10px 35px #0005; }
.composer.drafting { border-color:#49566a; }
.composer textarea { display:block; width:100%; min-height:76px; resize:none; border:0; outline:0; background:transparent; color:#eef0f2; padding:14px 15px; }
.composer-actions { display:flex; align-items:center; justify-content:space-between; padding:0 9px 9px 13px; color:#858d99; font-size:11px; }
.send { display:grid; width:32px; height:32px; place-items:center; border:0; border-radius:9px; background:#d8dde6; color:#111419; font-weight:800; }
.send.stop { background:#da6f76; color:white; }
.send:disabled { cursor:default; opacity:.35; }
.diagnostics { display:flex; flex-direction:column; background:#0d1014; }
.diagnostics .topbar { gap:10px; }
.filters { display:flex; gap:6px; }
select { max-width:130px; border:1px solid #303743; border-radius:7px; background:#171b21; color:#bcc3cd; padding:5px 7px; font-size:11px; }
.events { flex:1; overflow:auto; padding:9px; font-family:"SFMono-Regular",Consolas,monospace; }
.event { margin-bottom:6px; border:1px solid #262c35; border-radius:6px; background:#12161b; font-size:11px; }
.event summary { display:grid; grid-template-columns:68px 1fr auto; gap:8px; cursor:pointer; padding:7px; list-style:none; }
.event-time { color:#687180; }
.event-type { overflow:hidden; color:#b9c1cc; text-overflow:ellipsis; white-space:nowrap; }
.event-level { color:#788293; text-transform:uppercase; }
.event.error { border-color:#66383c; }.event.error .event-level { color:#ef8d94; }
.event.warn { border-color:#665533; }.event.warn .event-level { color:#e3bd68; }
.event pre { margin:0; border-top:1px solid #262c35; padding:9px; overflow:auto; color:#9fc7ad; white-space:pre-wrap; }
.error-banner { margin:8px 18px; border:1px solid #723b42; border-radius:7px; background:#3a2024; padding:8px 10px; color:#f2b4b8; font-size:12px; }
.toast { position:fixed; right:20px; bottom:20px; z-index:30; border:1px solid #445061; border-radius:8px; background:#252b34; padding:9px 13px; color:#e8ebef; font-size:12px; box-shadow:0 10px 32px #0008; }
@media (prefers-reduced-motion: reduce) { .run-status-dot { animation:none; } }
@media (max-width:1100px) { .app { grid-template-columns:220px minmax(400px,1fr) 320px; } }
`
