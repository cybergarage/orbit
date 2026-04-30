// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Role} from '../models/role.js'

import {Message, MessageType} from './message.js'

export class UserMessage extends Message {
  constructor(context: string[], role: Role) {
    super(MessageType.User, {contents: context, role})
  }
}
