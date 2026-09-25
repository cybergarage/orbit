// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'
import fs from 'node:fs/promises'
import path from 'node:path'

import {repo} from '../host.mjs'
import {makeCase} from './cases.mjs'
import {gradeBook} from './grade.mjs'

// Test-owned controls, never provided to the solving agent.
const control = `
const root = document.querySelector('#app');
root.innerHTML = '<div data-testid="moves">0</div><div data-testid="status"></div><div id="board" style="display:grid;grid-template-columns:repeat(4,1fr)"></div><button data-testid="reset">Reset</button>';
let deck, states, selected, moves, timer;
function render() {
  document.querySelector('[data-testid="moves"]').textContent = String(moves);
  document.querySelector('[data-testid="status"]').textContent = states.every(s=>s==='matched')?'Complete':'';
  document.querySelector('#board').innerHTML = deck.map((v,i)=>'<button data-testid="card" data-state="'+states[i]+'" '+(states[i]==='down'?'':'data-symbol="'+v+'"')+' aria-label="'+(states[i]==='down'?'Face down':v)+'">'+(states[i]==='down'?'?':v)+'</button>').join('');
  document.querySelectorAll('[data-testid="card"]').forEach((button,i)=>button.onclick=()=>select(i));
}
function reset(){ clearTimeout(timer); deck=Array.from({length:16},(_,i)=>String(i%8)); states=deck.map(()=>'down'); selected=[]; moves=0; render(); }
function select(i){
  if(states[i]!=='down'||selected.length===2)return;
  states[i]='up'; selected.push(i);
  if(selected.length===2){
    moves++; const [a,b]=selected;
    if(deck[a]===deck[b]){states[a]=states[b]='matched';selected=[];}
    else timer=setTimeout(()=>{states[a]=states[b]='down';selected=[];render();},800);
  }
  render();
}
document.querySelector('[data-testid="reset"]').onclick=reset;
reset();
`

describe('Book independent grader controls (Docker, no inference)', function () {
  this.timeout(0)
  for (const variant of ['good', 'starter', 'zero-tests', 'early-timer', 'reset-timer', 'fake-exit']) {
    it(`grades ${variant}`, async () => {
      await fs.mkdir(path.join(repo, 'tmp/e2e'), {recursive: true})
      const directory = await fs.mkdtemp(path.join(repo, 'tmp/e2e/book-control-'))
      const c = await makeCase('vibe')
      const files = {...c.files}
      if (variant !== 'starter') {
        files['index.html'] =
          '<html><body><div id="app"></div><script type="module" src="/src/control.js"></script></body></html>'
        files['src/control.js'] =
          variant === 'early-timer'
            ? control.replace('},800)', '},799)')
            : variant === 'reset-timer'
              ? control.replace('clearTimeout(timer);', '')
              : control
      }

      if (variant !== 'zero-tests')
        files['src/control.test.js'] =
          "import {it,expect} from 'vitest'; it('verifies the control',()=>expect(2+2).toBe(4));"
      if (variant === 'fake-exit') files['vite.config.js'] = 'process.exit(0);'
      for (const [name, content] of Object.entries(files)) {
        const file = path.join(directory, 'workspace', name)
        await fs.mkdir(path.dirname(file), {recursive: true})
        await fs.writeFile(file, content)
      }

      const result = await gradeBook(directory)
      expect(result.timedOut, result.stderr).to.equal(false)
      expect(result.passed, result.stdout + result.stderr).to.equal(variant === 'good')
      const reasons = {
        'early-timer': 'Mismatch must remain visible at 799ms',
        'fake-exit': 'test-result.json',
        'reset-timer': 'Reset must cancel the previous mismatch timer',
        starter: 'Expected 16 cards',
        'zero-tests': 'Check failed (1): /opt/book/node_modules/vitest/vitest.mjs',
      }
      if (variant !== 'good') expect(result.stdout + result.stderr).to.include(reasons[variant])
    })
  }
})
