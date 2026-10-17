// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import compose from './public/assets/2ca8c.svg'
import cancel from './public/assets/2ce2e.svg'
import folder from './public/assets/3a4c0.svg'
import chat from './public/assets/4b72a.svg'
import check from './public/assets/07d8e.svg'
import schedule from './public/assets/8e026.svg'
import pause from './public/assets/9befb.svg'
import settings from './public/assets/0023c.svg'
import once from './public/assets/942ba.svg'
import home from './public/assets/945ae.svg'
import send from './public/assets/4350f.svg'
import info from './public/assets/baff9.svg'
import plus from './public/assets/c92b5.svg'
import more from './public/assets/cca06.svg'
import logs from './public/assets/logs.svg'

const icons = {
  cancel,
  chat,
  check,
  compose,
  folder,
  home,
  info,
  logs,
  more,
  once,
  pause,
  plus,
  schedule,
  send,
  settings,
}

export function Icon({name}: {name: keyof typeof icons}) {
  return <img alt="" className={`orbit-icon icon-${name}`} src={icons[name]} />
}
