#!/usr/bin/env node

import {execute} from '@oclif/core'

import {normalizeCliArgs} from './args.js'

await execute({args: normalizeCliArgs(process.argv.slice(2), process.stdin.isTTY), dir: import.meta.url})
