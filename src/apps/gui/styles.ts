// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export const GUI_LAYOUT_STYLES = `
:root { color-scheme:light; background:#f5f6f8; color:#222935; font-size:14px; }
body { min-width:360px; }
button { border:0; border-radius:8px; background:transparent; }
button:hover { background:#e2e8f2; }
button, input, textarea { color:inherit; }
.app, .app.debug-hidden { display:grid; grid-template-columns:64px 280px minmax(0,1fr); background:#f5f6f8; height:100dvh; }
.pane { border:0; }
.primary-navigation { grid-column:1; grid-row:1; display:flex; flex-direction:column; align-items:center; gap:12px; background:#eef0f4; padding:24px 0 16px; }
.primary-navigation button { width:48px; height:52px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; font-size:9px; line-height:12px; }
.primary-navigation button:last-child { margin-top:auto; }
.primary-navigation button[aria-current=page], .active, .selected, .segmented button[aria-pressed=true] { background:#e2e8f2; }
.orbit-icon { display:block; flex-shrink:0; width:auto; height:auto; }
.icon-home, .icon-more, .icon-send { width:20px; height:20px; }
.primary-navigation .orbit-icon { max-width:20px; max-height:20px; }
.sidebar { grid-column:2; grid-row:1; padding:24px 16px; background:#eef0f4; gap:0; }
.brand { padding:0; height:40px; flex-shrink:0; margin:0 0 14px; }
.brand img { object-fit:contain; width:120px; height:40px; }
.nav-row, .new-chat { display:flex; align-items:center; gap:8px; min-height:40px; border:0; background:transparent; padding:8px; text-align:left; font-size:13px; }
.nav-row.active { background:#e2e8f2; }
.sidebar-navigation { margin:4px 0 0; }
.sidebar-heading { height:40px; margin:0 0 4px; padding-left:8px; color:#626d7c; font-size:11px; }
.sidebar-heading button { width:40px; height:40px; display:grid; place-items:center; padding:0; }
.project-row, .sidebar-session-row { min-height:40px; font-size:13px; }
.project-toggle { padding:8px; gap:8px; min-height:40px; }
.project-toggle > span:first-child { display:none; }
.project-sessions { margin-left:0; }
.sidebar-session-row .session { display:flex; align-items:center; gap:8px; min-height:40px; }
.session-title { color:#222935; font-size:13px; }
.row-action { width:32px; height:40px; display:grid; place-items:center; flex-shrink:0; opacity:1; padding:0; }
.sidebar-status { font-size:12px; }
.conversation, .workspace { grid-column:3; grid-row:1; min-height:0; min-width:0; background:#f5f6f8; }
.topbar { min-height:88px; border:0; padding:24px; gap:16px; background:white; }
.title { font-size:18px; font-weight:600; }
.topbar-actions button { font-size:14px; padding:8px; }
.topbar-actions .badge { position:absolute; top:53px; left:368px; padding:0; border:0; font-size:12px; color:#626d7c; max-width:50%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.messages { padding:32px 40px; }
.message { max-width:760px; padding:24px; margin:0 auto 20px; border-radius:12px; background:white; }
.message-label { color:#222935; font-size:14px; line-height:21px; font-weight:500; letter-spacing:0; text-transform:none; margin-bottom:8px; }
.message-body { font-size:14px; line-height:21px; }
.message.user .message-body { padding:0; background:transparent; border-radius:0; display:block; }
.sample-task { background:#2c2c2c; color:white; padding:12px 16px; margin:4px 0 12px; }
.global-error-banner { position:fixed; top:88px; left:360px; right:16px; z-index:20; }
.empty { max-width:760px; height:320px; margin:0 auto; justify-content:start; text-align:left; font-size:15px; line-height:1.5; padding:24px; }
.composer-status { max-width:760px; margin:12px auto 0; }
.composer-wrap { padding:24px 40px 32px; }
.composer { max-width:760px; border-radius:8px; box-shadow:none; background:white; position:relative; }
.composer textarea { min-height:54px; padding:16px 64px 8px 16px; color:#222935; font-size:14px; }
.composer-actions { min-height:54px; padding:8px 64px 16px 16px; color:#626d7c; font-size:13px; }
.send { position:absolute; right:12px; bottom:12px; width:40px; height:40px; background:transparent; }
.home-details, .advanced-controls { display:none; }
.details-open .home-details, .advanced-open .advanced-controls { display:block; max-height:40vh; overflow:auto; }
.diagnostics { position:fixed; z-index:8; top:88px; right:0; bottom:0; width:min(480px,calc(100vw - 64px)); box-shadow:-8px 0 24px #22293520; background:white; }
.diagnostics .topbar { flex-wrap:wrap; padding:12px; }
.diagnostics .filters { flex-wrap:wrap; }
.context-menu { box-shadow:0 8px 24px #22293520; }
.context-menu-danger { color:#b42332 !important; }
.dialog { background:white; color:#222935; box-shadow:0 16px 48px #22293530; border-color:#d9dfe7; }
.dialog p, .dialog label { color:#626d7c; }
.sidebar-dialog input[type=checkbox] { display:inline-block; width:auto; margin:0 8px 0 0; }
.dialog-backdrop { background:#22293555; }
.session-detail dd, .session-id-row code { color:#222935; }
.workspace { display:flex; flex-direction:column; }
.workspace-content { overflow:auto; flex:1; min-height:0; padding:28px 40px; }
.surface { background:white; border-radius:12px; padding:24px; margin-bottom:20px; }
h2 { margin:0 0 16px; font-size:18px; font-weight:400; line-height:1.5; }
p { line-height:1.5; }
.muted { font-size:12px; color:#626d7c; line-height:1.5; }
.workspace .topbar { padding-left:40px; padding-right:40px; }
.workspace .topbar .title { font-size:20px; font-weight:400; }
.schedule-detail { display:flex; flex-direction:column; align-items:flex-start; gap:8px; }
.schedule-detail h2 { font-size:22px; margin:0; }
.schedule-detail p { margin:0; }
.schedule-detail .inline-actions { flex-wrap:wrap; }
.schedule-detail .inline-actions button:first-child { width:210px; }
.schedule-detail .inline-actions button:last-child { width:150px; }
.schedule-status { color:#19745e; font-size:14px; }
.schedule-list { overflow:auto; min-height:0; }
.context-list .sidebar-heading { height:18px; margin:4px 0; padding-left:0; flex-shrink:0; line-height:18px; }
.context-list > .nav-row + .nav-row { margin-top:4px; }
.schedule-item { height:96px; line-height:20px; width:100%; text-align:left; padding:12px 8px; display:flex; flex-direction:column; gap:4px; font-size:13px; }
.schedule-item small { line-height:19px; color:#626d7c; font-size:12px; }
.inline-actions, .segmented { display:flex; gap:16px; align-items:center; }
.inline-actions button, .segmented button, .history-row > button { display:flex; align-items:center; gap:8px; min-height:40px; padding:8px 12px; font-size:13px; }
.history-row { display:flex; align-items:start; justify-content:space-between; gap:16px; margin:16px 0; }
.history-row p { margin:4px 0; }
.history-row pre { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; font-size:12px; color:#626d7c; }
.task-columns { display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:start; }
.task-columns label { display:block; margin:16px 0; font-size:13px; }
.task-columns input, .task-columns textarea, .dialog textarea { display:block; width:100%; padding:10px 12px; border:1px solid #d9dfe7; border-radius:8px; margin-top:8px; background:white; font:inherit; }
.task-columns textarea { min-height:90px; resize:vertical; }
.task-columns .segmented { gap:8px; }
.task-columns .segmented button { flex:1; }
.form-actions { gap:32px; }
.form-actions button { min-width:160px; }
.scheduler-help { color:#626d7c; font-size:12px; margin-top:32px; }
.settings-workspace { background:#f5f6f8; }
.settings-workspace .topbar { background:transparent; }
.settings-workspace .workspace-content { padding-top:28px; display:flex; flex-direction:column; align-items:flex-start; gap:24px; }
.settings-workspace .workspace-content > h2, .settings-workspace .workspace-content > p { margin:0; }
.settings-workspace h2 { margin-bottom:32px; }
.settings-toggle { display:flex; gap:24px; align-items:center; min-height:56px; margin:0; font-size:13px; }
.settings-toggle button { display:flex; align-items:center; gap:8px; height:40px; width:90px; padding:8px; }
.settings-workspace .segmented { margin:0; gap:8px; }
.settings-workspace .segmented button { width:100px; padding:8px; }
.settings-workspace .segmented button:nth-child(2) { width:130px; }
.drawer-toggle, .drawer-backdrop { display:none; }
@media (max-width:1100px) {
 .app, .app.debug-hidden { grid-template-columns:64px minmax(0,1fr); }
 .conversation, .workspace { grid-column:2; }
 .sidebar { display:none; }
 .global-error-banner { left:72px; }
 .drawer-toggle { display:flex; align-items:center; gap:8px; position:fixed; left:88px; top:24px; z-index:7; height:40px; font-size:13px; background:white; }
 .topbar { padding-left:132px; }
 .topbar-actions .badge { left:196px; max-width:45%; }
 .drawer-open .sidebar { display:flex; position:fixed; left:64px; top:0; bottom:0; width:280px; z-index:12; box-shadow:8px 0 24px #22293520; }
 .drawer-backdrop:hover { background:#22293530; }
 .drawer-backdrop { display:block; position:fixed; inset:0 0 0 64px; z-index:11; background:#22293530; border-radius:0; }
 .task-columns { grid-template-columns:1fr; gap:0; }
 .workspace .topbar { padding-left:132px; }
}
@media (max-width:650px) {
 .topbar { padding:16px 12px 16px 96px; min-height:88px; flex-wrap:wrap; }
 .title { font-size:15px; }
 .drawer-toggle { left:72px; font-size:11px; padding:6px; }
 .topbar-actions { gap:0; }
 .topbar-actions button { padding:4px; font-size:12px; }
 .topbar-actions .badge { display:none; }
 .messages, .workspace-content { padding:20px 16px; }
 .composer-wrap { padding:16px; }
 .composer-actions { font-size:11px; }
 .history-row { flex-direction:column; }
 .surface { padding:20px; }
 .form-actions { gap:8px; }
 .form-actions button { min-width:0; }
}
`
