// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ModelSelection} from './session/model-selection.js'
import type {WorkspaceSettings} from './settings.js'

import {ModelCatalog} from './model-catalog.js'
const catalog = new ModelCatalog()
/** Compatibility flat view. New clients should use the grouped ModelCatalog API. */
export async function discoverModelChoices(
  settings: WorkspaceSettings,
  _configured: ModelSelection,
): Promise<ModelSelection[]> {
  return (await catalog.list(settings)).providers.flatMap((provider) =>
    provider.status === 'available' ? provider.models.map(({model, provider}) => ({model, provider})) : [],
  )
}
