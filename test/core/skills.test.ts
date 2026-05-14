// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {InvalidInputError, Skill} from '../../src/core/index.js'

describe('skills', () => {
  it('builds a Skill from content', () => {
    const skill = new Skill({content: 'Use concise answers.'})

    expect(skill.content).to.equal('Use concise answers.')
    expect(skill.instructions).to.equal('Use concise answers.')
    expect(skill.source).to.deep.equal({kind: 'content'})
  })

  it('parses markdown frontmatter metadata and instructions', () => {
    const skill = new Skill({
      content: `---
name: summarize
description: Summarize long text.
---

# Instructions

Keep the response short.`,
    })

    expect(skill.name).to.equal('summarize')
    expect(skill.description).to.equal('Summarize long text.')
    expect(skill.instructions).to.equal('# Instructions\n\nKeep the response short.')
  })

  it('lets constructor metadata override frontmatter metadata', () => {
    const skill = new Skill({
      content: `---
name: frontmatter_name
description: Frontmatter description.
---

Body`,
      description: 'Constructor description.',
      name: 'constructor_name',
    })

    expect(skill.name).to.equal('constructor_name')
    expect(skill.description).to.equal('Constructor description.')
    expect(skill.instructions).to.equal('Body')
  })

  it('loads a Skill from a file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-skill-'))
    const file = path.join(root, 'SKILL.md')
    await fs.writeFile(
      file,
      `---
name: file_skill
description: Loaded from disk.
---

Read the repository first.`,
    )

    const skill = new Skill({file})

    expect(skill.name).to.equal('file_skill')
    expect(skill.description).to.equal('Loaded from disk.')
    expect(skill.instructions).to.equal('Read the repository first.')
    expect(skill.source).to.deep.equal({file, kind: 'file'})
  })

  it('treats markdown without frontmatter as instructions', () => {
    const skill = new Skill({content: '# Instructions\n\nDo the work.'})

    expect(skill.name).to.equal(undefined)
    expect(skill.description).to.equal(undefined)
    expect(skill.instructions).to.equal('# Instructions\n\nDo the work.')
  })

  it('throws InvalidInputError when a file cannot be loaded', () => {
    expect(() => new Skill({file: path.join(os.tmpdir(), 'missing-skill.md')})).to.throw(InvalidInputError)
  })

  it('is exported from the public core API', () => {
    expect(new Skill({content: 'Public export.'})).to.be.instanceOf(Skill)
  })
})
