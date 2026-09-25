// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* global document, HTMLElement, HTMLDivElement, KeyboardEvent, MouseEvent, window */
/* eslint-disable n/no-unsupported-features/node-builtins */
import {type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState} from 'react'

import type {Project, ProjectMembership, SessionSummary} from '../../core/index.js'

import {moveSidebarSession, type SidebarApi, SidebarModel, type SidebarSession} from './sidebar-model.js'

type MenuTarget = {kind: 'catalog'} | {kind: 'project'; project: Project} | {kind: 'session'; session: SidebarSession}
type Menu = MenuTarget & {x: number; y: number}
type Editor = {directory: string; name: string; project?: Project}
type Move = {destination: string; membership: null | ProjectMembership; projects: Project[]; session: SessionSummary}
interface Props {
  api: SidebarApi
  onCopy: (session: SessionSummary) => void
  onCreate: (projectId: null | string) => Promise<void>
  onDelete: (session: SessionSummary) => void
  onDetails: (session: SessionSummary) => void
  onEnabled: (enabled: boolean) => void
  onMenuClosed: () => void
  onMoved: (sessionId: string, membership: ProjectMembership) => Promise<void>
  onRememberFocus: (element: HTMLElement) => void
  onSelect: (session: SessionSummary, projectId: null | string) => Promise<void>
  onSessions: (sessions: SessionSummary[]) => void
  requestedMenu?: {session: SessionSummary; x: number; y: number}
  revision: number
  selectedId?: string
}

// Sidebar composes project, session, menu, and dialog states at one navigation boundary.
// eslint-disable-next-line complexity
export function Sidebar(props: Props) {
  const [version, redraw] = useState(0)
  const [model] = useState(() => new SidebarModel(props.api, () => redraw((value) => value + 1)))
  const [menu, setMenu] = useState<Menu>()
  const [editor, setEditor] = useState<Editor>()
  const [move, setMove] = useState<Move>()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string>()
  const returnFocus = useRef<HTMLElement | null>(null)
  const operations = useRef(new Map<string, string>())
  const operationId = (key: string) => {
    if (!operations.current.has(key)) operations.current.set(key, crypto.randomUUID())
    return operations.current.get(key)!
  }

  useEffect(() => {
    if (props.requestedMenu) {
      returnFocus.current = document.activeElement as HTMLElement
      setMenu({...props.requestedMenu, kind: 'session'})
    }
  }, [props.requestedMenu])
  useEffect(() => {
    model.refresh()
  }, [model, props.revision])
  useEffect(() => {
    props.onEnabled(model.enabled)
  }, [model.enabled, props.onEnabled])
  useEffect(() => {
    props.onSessions(Object.values(model.groups).flatMap((group) => group.sessions))
  }, [version, model, props.onSessions])

  const restoreFocus = () => {
    if (returnFocus.current?.isConnected) returnFocus.current.focus()
    else globalThis.setTimeout(() => document.querySelector<HTMLElement>('.new-chat')?.focus(), 0)
  }

  const closeMenu = () => {
    setMenu(undefined)
    props.onMenuClosed()
    restoreFocus()
  }

  const closeDialog = () => {
    if (busyRef.current) return
    setEditor(undefined)
    setMove(undefined)
    setError(undefined)
    restoreFocus()
  }

  const openMenu = (event: ReactMouseEvent<HTMLElement>, target: MenuTarget) => {
    event.preventDefault()
    returnFocus.current = event.currentTarget
    props.onRememberFocus(event.currentTarget)
    const bounds = event.currentTarget.getBoundingClientRect()
    setMenu({
      ...target,
      x: Math.max(8, Math.min(event.clientX || bounds.right, window.innerWidth - 224)),
      y: Math.max(8, Math.min(event.clientY || bounds.top, window.innerHeight - 230)),
    } as Menu)
  }

  const act = async (action: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const editProject = (project?: Project) => {
    closeMenu()
    setError(undefined)
    setEditor({directory: project?.defaultDirectory ?? '', name: project?.name ?? '', project})
  }

  const writeProject = async (value: Editor, archived = value.project?.archived ?? false) => {
    const {project} = value
    const body = {
      directory: value.directory.trim() || null,
      name: value.name.trim(),
      ...(project ? {archived, expectedRevision: project.revision} : {}),
    }
    const path = project ? `/api/projects/${encodeURIComponent(project.id)}` : '/api/projects'
    const key = JSON.stringify([path, body])
    await props.api(path, {
      body: JSON.stringify({...body, operationId: operationId(key)}),
      headers: {'Content-Type': 'application/json'},
      method: project ? 'PATCH' : 'POST',
    })
    operations.current.delete(key)
    setEditor(undefined)
    if (!project) model.archived = false
    await model.refresh()
    globalThis.setTimeout(restoreFocus, 0)
  }

  const prepareMove = (session: SessionSummary) => {
    closeMenu()
    act(async () => {
      const [result, catalog] = await Promise.all([
        props.api<{membership: null | ProjectMembership}>(`/api/sessions/${encodeURIComponent(session.id)}/membership`),
        model.allProjects(false),
      ])
      setMove({
        destination: result.membership?.projectId ?? '',
        membership: result.membership,
        projects: catalog.data,
        session,
      })
    })
  }

  const commitMove = async (value: Move) => {
    const key = JSON.stringify(['move', value.session.id, value.membership, value.destination])
    const membership = await moveSidebarSession(props.api, {
      destination: value.destination || null,
      membership: value.membership,
      operationId: operationId(key),
      sessionId: value.session.id,
    })
    operations.current.delete(key)
    setMove(undefined)
    if (membership.projectId) model.expanded.add(membership.projectId)
    try {
      await props.onMoved(value.session.id, membership)
    } finally {
      await model.refresh()
      globalThis.setTimeout(restoreFocus, 0)
    }
  }

  const renderGroup = (projectId: null | string) => {
    const group = model.groups[projectId ?? '']
    return (
      <div aria-busy={group?.loading ?? true} className={projectId ? 'project-sessions' : 'recent-sessions'}>
        {group?.sessions.map((session) => (
          <div className={`sidebar-session-row ${props.selectedId === session.id ? 'active' : ''}`} key={session.id}>
            <button
              className="session"
              disabled={session.pendingProjectCreation}
              onClick={() => props.onSelect(session, projectId)}
              onContextMenu={(event) => openMenu(event, {kind: 'session', session})}
              title={session.preview || session.id}
            >
              <span className="session-title">{session.preview || `${session.provider ?? 'Orbit'} session`}</span>
              {session.pendingProjectCreation && <span className="session-meta">Project creation incomplete</span>}
            </button>
            <button
              aria-label={`Actions for ${session.preview || session.id}`}
              className="row-action"
              onClick={(event) => openMenu(event, {kind: 'session', session})}
            >
              …
            </button>
            {session.pendingProjectId && (
              <button
                className="sidebar-more"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await props.api(`/api/projects/${encodeURIComponent(session.pendingProjectId!)}/threads`, {
                      body: JSON.stringify({operationId: session.id}),
                      headers: {'Content-Type': 'application/json'},
                      method: 'POST',
                    })
                    await model.refresh()
                  })
                }
              >
                Retry incomplete creation
              </button>
            )}
          </div>
        ))}
        {group?.unavailable.map((id) => (
          <p className="sidebar-status" key={id}>
            Unavailable conversation: {id}
          </p>
        ))}
        {group?.error ? (
          <div className="sidebar-status" role="alert">
            {group.error}
            <button onClick={() => model.loadGroup(projectId)}>Retry</button>
          </div>
        ) : null}
        {(!group || group.loading) && (
          <p className="sidebar-status" role="status">
            Loading…
          </p>
        )}
        {group &&
          !group.loading &&
          !group.error &&
          group.sessions.length === 0 &&
          group.unavailable.length === 0 &&
          !group.cursor && <p className="sidebar-status">No chats</p>}
        {group?.cursor && (
          <button className="sidebar-more" disabled={group.loading} onClick={() => model.loadGroup(projectId, true)}>
            Show more
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <button className="primary new-chat" disabled={busy} onClick={() => act(() => props.onCreate(null))}>
        ＋ New Chat
      </button>
      <nav aria-label="Projects and sessions" className="sidebar-navigation">
        {(model.enabled || model.catalogError) && (
          <>
            <div className="sidebar-heading">
              <span>Project</span>
              <button
                aria-label="Create project"
                disabled={busy}
                onClick={(event) => {
                  returnFocus.current = event.currentTarget
                  editProject()
                }}
              >
                ＋
              </button>
              <button aria-label="Project options" onClick={(event) => openMenu(event, {kind: 'catalog'})}>
                …
              </button>
            </div>
            {model.archived && <p className="sidebar-status">Archived projects</p>}
            {model.projects.map((project) => (
              <div key={project.id}>
                <div className="project-row">
                  <button
                    aria-expanded={model.expanded.has(project.id)}
                    className="project-toggle"
                    onClick={() => model.toggle(project.id)}
                    onContextMenu={(event) => openMenu(event, {kind: 'project', project})}
                  >
                    <span aria-hidden="true">{model.expanded.has(project.id) ? '▾' : '▸'}</span>
                    <SidebarIcon kind="folder" />
                    <span>{project.name}</span>
                  </button>
                  <button
                    aria-label={`New Chat in ${project.name}`}
                    className="row-action"
                    disabled={busy || project.archived}
                    onClick={() =>
                      act(async () => {
                        model.expanded.add(project.id)
                        await props.onCreate(project.id)
                        await model.loadGroup(project.id)
                      })
                    }
                    title={`New Chat in ${project.name}`}
                  >
                    <SidebarIcon kind="compose" />
                  </button>
                  <button
                    aria-label={`Project actions for ${project.name}`}
                    className="row-action"
                    onClick={(event) => openMenu(event, {kind: 'project', project})}
                  >
                    …
                  </button>
                </div>
                {model.expanded.has(project.id) && renderGroup(project.id)}
              </div>
            ))}
            {model.catalogLoading && (
              <p className="sidebar-status" role="status">
                Loading projects…
              </p>
            )}
            {model.catalogError && (
              <div className="sidebar-status" role="alert">
                {model.catalogError}
                <button onClick={() => model.refresh()}>Retry projects</button>
              </div>
            )}
            {!model.catalogLoading && !model.catalogError && model.projects.length === 0 && (
              <p className="sidebar-status">No projects</p>
            )}
          </>
        )}
        <div className="sidebar-heading">
          <span>Recent</span>
        </div>
        {renderGroup(null)}
      </nav>
      {error && !editor && !move && (
        <div className="sidebar-status" role="alert">
          {error}
          <button onClick={() => setError(undefined)}>Dismiss</button>
        </div>
      )}
      {menu && (
        <ActionMenu menu={menu} onClose={closeMenu}>
          {menu.kind === 'catalog' && (
            <button
              onClick={() => {
                closeMenu()
                model.archived = !model.archived
                model.refresh()
              }}
              role="menuitem"
            >
              {model.archived ? 'Show active projects' : 'Show archived projects'}
            </button>
          )}
          {menu.kind === 'project' && (
            <>
              <button
                disabled={busy || menu.project.archived}
                onClick={() => {
                  closeMenu()
                  act(async () => {
                    model.expanded.add(menu.project.id)
                    await props.onCreate(menu.project.id)
                    await model.loadGroup(menu.project.id)
                  })
                }}
                role="menuitem"
              >
                New Chat
              </button>
              <button disabled={busy} onClick={() => editProject(menu.project)} role="menuitem">
                Project settings…
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  closeMenu()
                  act(() =>
                    writeProject(
                      {directory: menu.project.defaultDirectory ?? '', name: menu.project.name, project: menu.project},
                      !menu.project.archived,
                    ),
                  )
                }}
                role="menuitem"
              >
                {menu.project.archived ? 'Unarchive project' : 'Archive project'}
              </button>
            </>
          )}
          {menu.kind === 'session' && (
            <>
              <button
                onClick={() => {
                  closeMenu()
                  props.onCopy(menu.session)
                }}
                role="menuitem"
              >
                Copy session ID
              </button>
              <button
                onClick={() => {
                  closeMenu()
                  props.onDetails(menu.session)
                }}
                role="menuitem"
              >
                Session details…
              </button>
              {model.enabled && (
                <button
                  disabled={busy || menu.session.pendingProjectCreation}
                  onClick={() => prepareMove(menu.session)}
                  role="menuitem"
                >
                  Move to project…
                </button>
              )}
              <div className="context-menu-separator" role="separator" />
              <button
                className="context-menu-danger"
                onClick={() => {
                  closeMenu()
                  props.onDelete(menu.session)
                }}
                role="menuitem"
              >
                Delete session…
              </button>
            </>
          )}
        </ActionMenu>
      )}
      {editor && (
        <SidebarDialog onClose={closeDialog} title={editor.project ? 'Project settings' : 'Create project'}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              act(() => writeProject(editor))
            }}
          >
            <label>
              Name
              <input
                aria-label="Project name"
                autoFocus
                disabled={busy}
                maxLength={256}
                onChange={(event) => setEditor({...editor, name: event.target.value})}
                required
                value={editor.name}
              />
            </label>
            <label>
              Default directory
              <input
                aria-label="Project directory"
                disabled={busy}
                onChange={(event) => setEditor({...editor, directory: event.target.value})}
                placeholder="Use startup directory"
                value={editor.directory}
              />
            </label>
            <p>The default directory applies to new chats. Existing chats retain their recorded directory.</p>
            {error && <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <button disabled={busy} onClick={closeDialog} type="button">
                Cancel
              </button>
              <button disabled={busy || !editor.name.trim()} type="submit">
                {editor.project ? 'Save changes' : 'Create project'}
              </button>
            </div>
          </form>
        </SidebarDialog>
      )}
      {move && (
        <SidebarDialog onClose={closeDialog} title="Move to project">
          <div className="dialog-session">{move.session.preview || move.session.id}</div>
          <p>
            Moving retains the recorded directory and all previous messages. Linked memories in the old Project stop
            being used. Active or quarantined conversations cannot be moved.
          </p>
          <label>
            Destination project
            <select
              aria-label="Destination project"
              autoFocus
              disabled={busy}
              onChange={(event) => setMove({...move, destination: event.target.value})}
              value={move.destination}
            >
              <option value="">Unassigned</option>
              {move.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button disabled={busy} onClick={closeDialog}>
              Cancel
            </button>
            <button
              disabled={busy || move.destination === (move.membership?.projectId ?? '')}
              onClick={() => act(() => commitMove(move))}
            >
              Move conversation
            </button>
          </div>
        </SidebarDialog>
      )}
    </>
  )
}

function ActionMenu({children, menu, onClose}: {children: ReactNode; menu: Menu; onClose: () => void}) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as HTMLElement)) close.current()
    }

    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [menu])
  return (
    <div
      aria-label={menu.kind === 'session' ? 'Session actions' : 'Project actions'}
      className="context-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault()
          onClose()
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const buttons = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled)')]
          const index = buttons.indexOf(document.activeElement as HTMLElement)
          buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
        }
      }}
      ref={ref}
      role="menu"
      style={{left: menu.x, top: menu.y}}
    >
      {children}
    </div>
  )
}

function SidebarDialog({children, onClose, title}: {children: ReactNode; onClose: () => void; title: string}) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
      }

      if (event.key !== 'Tab') return
      const inputs = [
        ...ref.current!.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
        ),
      ]
      if (inputs.length === 0) {
        event.preventDefault()
        return
      }

      if (!inputs.includes(document.activeElement as HTMLElement)) {
        event.preventDefault()
        inputs[0].focus()
        return
      }

      const first = inputs[0]
      const last = inputs.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [])
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="sidebar-dialog-title"
        aria-modal="true"
        className="dialog sidebar-dialog"
        ref={ref}
        role="dialog"
      >
        <h2 id="sidebar-dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function SidebarIcon({kind}: {kind: 'compose' | 'folder'}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width="16"
    >
      {kind === 'folder' ? (
        <path d="M3 7V5h6l2 3h10v3M3 7v13h16l3-9H7l-4 9" />
      ) : (
        <>
          <path d="M14 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-9" />
          <path d="m16 3 5 5-10 10-5 1 1-5Z" />
        </>
      )}
    </svg>
  )
}
