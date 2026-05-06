// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Session} from './session/index.js'

export class State {
  public readonly session: Session

  constructor(session?: Session) {
    this.session = session ?? new Session()
  }

  getSession(): Session {
    return this.session
  }
}
