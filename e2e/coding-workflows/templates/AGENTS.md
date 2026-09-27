# Project

Build a browser-based memory matching game with TypeScript, HTML, and CSS.

## Technology stack

- Node.js 24 LTS
- TypeScript
- Vite
- Vitest
- No UI framework
- No backend

## Verification commands

- Install dependencies: `npm ci`
- Type-check: `npm run typecheck`
- Unit tests: `npm test`
- Build: `npm run build`
- Development server: `npm run dev`

## Working rules

- Inspect the relevant files before starting work.
- Change only the requested scope.
- Separate game state transitions from DOM operations.
- Add a new dependency only when you can explain why it is necessary.
- If `node_modules` does not exist, use `npm ci`, not `npm install`.
- Verify changes with the type-check, tests, and build.
- Do not report a check as successful unless you ran it.
- Do not access `.env`, credentials, or files outside the working directory.
- Do not use network access, web search, or browser automation.
- Do not perform destructive Git operations.
