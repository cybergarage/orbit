// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export function validateSWECase(selected) {
  const id = selected?.instance_id
  if (
    typeof id !== 'string' ||
    !/^[a-zA-Z0-9_.-]+__[a-zA-Z0-9_.-]+$/.test(id) ||
    selected.dataset !== 'princeton-nlp/SWE-bench_Verified' ||
    selected.split !== 'test' ||
    !/^[a-f0-9]{40}$/.test(selected.revision) ||
    !/^[a-f0-9]{40}$/.test(selected.base_commit)
  )
    throw new Error('Case requires a pinned Verified test instance')
  const prefix = `swebench/sweb.eval.x86_64.${id.replaceAll('__', '_1776_')}@sha256:`
  if (
    typeof selected.image !== 'string' ||
    !selected.image.startsWith(prefix) ||
    !/^[a-f0-9]{64}$/.test(selected.image.slice(prefix.length))
  )
    throw new Error('Case requires a matching digest-pinned official image')
  return selected
}

export function verifyPreparedSWECase(instance, selected, instanceId) {
  if (instance.instance_id !== instanceId || (selected && instance.base_commit !== selected.base_commit))
    throw new Error('Prepared instance does not match selected case')
}
