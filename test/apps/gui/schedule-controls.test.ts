// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {build} from 'esbuild'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

type Element = {
  props: {
    children?: Element[] | string
    disabled?: boolean
    onClick?: () => Promise<void>
    onSubmit?: (event: {preventDefault: () => void}) => unknown
    role?: string
    type?: string
  }
  type: string
}

// Exercise the form's event contract without mounting a browser or running a task.
async function controls(
  api: (url: string, init?: {method?: string}) => Promise<unknown>,
  state: unknown[],
): Promise<Element> {
  const source = new URL('../../../src/apps/gui/workspaces.tsx', import.meta.url)
  const result = await build({
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    loader: {'.png': 'dataurl', '.svg': 'dataurl'},
    plugins: [
      {
        name: 'form-hooks',
        setup(builder) {
          builder.onResolve({filter: /^react(?:\/jsx-runtime)?$/}, (args) => ({
            namespace: 'form-hooks',
            path: args.path,
          }))
          builder.onLoad({filter: /.*/, namespace: 'form-hooks'}, () => ({
            contents: `
          let i = 0; export const useState = value => [globalThis.__scheduleFixture[i++] ?? value, () => {}];
          export const useRef = value => ({current: value});
          export const useEffect = () => {};
          export const useCallback = value => value;
          export const jsx = (type, props) => ({type, props});
          export const jsxs = jsx;
          export const Fragment = 'fragment';
        `,
          }))
        },
      },
    ],
    stdin: {
      contents: `${await readFile(source, 'utf8')}\nexport {TaskForm};`,
      loader: 'tsx',
      resolveDir: fileURLToPath(new URL('.', source)),
    },
    write: false,
  })
  Object.assign(globalThis, {__scheduleFixture: state})
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + '\n//' + JSON.stringify(state)).toString('base64')}`
  )
  const render = module.ScheduledWorkspace
  return render({api, closeDrawer() {}})
}

function buttons(element: Element | undefined): Element[] {
  if (!element || typeof element !== 'object' || !element.props) return []
  const children = [element.props.children].flat()
  return [...(element.type === 'button' ? [element] : []), ...children.flatMap((child) => buttons(child as Element))]
}

describe('GUI schedule controls', () => {
  it('requires confirmation and sends only schedule deletion while retaining run history', async () => {
    const requests: unknown[] = []
    const schedule = {
      id: 'fixture',
      interval: 1000,
      next: 9000,
      paused: true,
      payload: {name: 'Synthetic', workspace: '/synthetic'},
    }
    const state = {attempts: [], occurrences: [], runs: [], schedules: [schedule]}
    const api = async (url: string, init?: {method?: string}) => {
      requests.push({method: init?.method, url})
      return state
    }

    const unconfirmed = buttons(await controls(api, [state, 'fixture']))
    expect(unconfirmed.some((button) => button.props.children === 'Confirm delete')).equal(false)
    expect(requests).length(0)
    const confirmed = buttons(await controls(api, [state, 'fixture', false, undefined, undefined, false, 'fixture']))
    const deletion = confirmed.find((button) => button.props.children === 'Confirm delete')!
    await deletion.props.onClick!()
    expect(requests[0]).deep.equal({method: 'DELETE', url: '/api/schedules/fixture'})
    expect(requests).length(2)
  })
})
