// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {build} from 'esbuild'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

export type Element = {
  props: {
    children?: Element[] | string
    disabled?: boolean
    onClick?: () => Promise<void>
    onSubmit?: (event: {preventDefault: () => void}) => unknown
    type?: string
  }
  type: string
}

// Exercise the form's event contract without mounting a browser or running a task.
export async function renderWorkspaceComponent(name: string, props: unknown, state: unknown[] = []): Promise<Element> {
  const source = new URL('../../../../src/apps/gui/workspaces.tsx', import.meta.url)
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
  return module[name](props)
}

export function buttons(element: Element | undefined): Element[] {
  if (!element || typeof element !== 'object' || !element.props) return []
  const children = [element.props.children].flat()
  return [...(element.type === 'button' ? [element] : []), ...children.flatMap((child) => buttons(child as Element))]
}
