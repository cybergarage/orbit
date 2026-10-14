// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {build} from 'esbuild'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

type Element = {
  props: {
    children?: Element[]
    disabled?: boolean
    onSubmit?: (event: {preventDefault: () => void}) => unknown
    type?: string
  }
  type: string
}

// Exercise the form's event contract without mounting a browser or running a task.
async function form(onCreate: (value: unknown) => Promise<void>): Promise<Element> {
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
          export const useState = value => [value, () => {}];
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
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )
  const renderForm = module.TaskForm
  return renderForm({busy: false, onCancel() {}, onCreate})
}

function buttons(element: Element | undefined): Element[] {
  if (!element || typeof element !== 'object' || !element.props) return []
  const children = [element.props.children].flat()
  return [...(element.type === 'button' ? [element] : []), ...children.flatMap((child) => buttons(child))]
}

describe('GUI scheduled task form', () => {
  it('submits once through the handled creation callback and prevents native navigation', async () => {
    const values: unknown[] = []
    let prevented = false
    const element = await form(async (value) => {
      values.push(value)
    })
    expect(
      element.props.onSubmit!({
        preventDefault() {
          prevented = true
        },
      }),
    ).equal(undefined)
    expect(prevented).equal(true)
    expect(values).have.length(1)
    expect(values[0]).have.nested.property('task.permissions', 'workspace-read')
  })

  it('explicitly submits from Create and keeps Cancel outside form submission', async () => {
    const controls = buttons(await form(async () => {})).slice(-2)
    expect(controls.map((button) => button.props.type)).deep.equal(['button', 'submit'])
    expect(controls.every((button) => button.props.disabled === false)).equal(true)
  })
})
