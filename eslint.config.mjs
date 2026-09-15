import {includeIgnoreFile} from '@eslint/compat'
import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

export default [
  includeIgnoreFile(gitignorePath),
  ...oclif,
  prettier,
  {
    files: ['examples/assistant/src/**/*.ts'],
    // This standalone consumer resolves Orbit only after installing the tarball.
    // test:package checks its actual imports and declarations with TypeScript.
    rules: {'import/no-unresolved': 'off'},
  },
]
