#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import {execute} from '@oclif/core'

import {normalizeCliArgs} from './args.js'

await execute({args: normalizeCliArgs(process.argv.slice(2)), development: true, dir: import.meta.url})
