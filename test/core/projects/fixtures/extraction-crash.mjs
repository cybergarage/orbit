import path from 'node:path'
import {pathToFileURL} from 'node:url'
const {AutomaticProjectMemory, SqliteProjectStore} = await import(pathToFileURL(path.join(process.cwd(), 'dist/core/index.js')).href)
const [file, id, boundary] = process.argv.slice(2)
const store = await SqliteProjectStore.open({file})
const job = await store.query({id, kind: 'extraction'})
const runner = new AutomaticProjectMemory(store, async () => {throw new Error('No live inference')}, async (_job, apply) => {await apply?.();return true})
if (boundary === 'before-claim') process.kill(process.pid, 'SIGKILL')
const claim = await runner.claim(job)
if (boundary === 'after-claim') process.kill(process.pid, 'SIGKILL')
const response = {text: JSON.stringify({candidates: [{body: 'Use PostgreSQL.', condition: '', importance: 3,
  kind: 'decision', messageId: job.messages[0].id, quote: job.messages[0].text, title: 'Storage'}]})}
if (boundary === 'after-inference') process.kill(process.pid, 'SIGKILL')
await runner.complete(claim.job, response)
process.kill(process.pid, 'SIGKILL')
