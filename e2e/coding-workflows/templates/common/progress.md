# Work Progress

## Goal

Implement the memory matching game in `spec.md` and satisfy the checks in `test.md`.

## Working rules

- Do not change `spec.md` or `test.md`.
- Do not add features that are not in the specification.
- Add a new dependency only if the existing stack cannot meet a requirement.
- Do not access `.env`, credentials, or files outside the working directory.
- Do not perform destructive Git operations.
- Record only verified facts in this file.

## Allowed verification commands

```console
npm ci
npm run typecheck
npm test
npm run build
```

## Status

- [ ] Reviewed the specification and test plan
- [ ] Implemented game state and state transitions
- [ ] Implemented the game screen
- [ ] Implemented unit tests
- [ ] Type-check succeeded
- [ ] Unit tests succeeded
- [ ] Build succeeded
- [ ] Verified basic operation in a browser
- [ ] Verified keyboard operation in a browser
- [ ] Verified the layout at a width of 320 pixels

## Results

| Check | Command or method | Result | Verified at |
| --- | --- | --- | --- |
| Type-check | `npm run typecheck` | Not run | - |
| Unit tests | `npm test` | Not run | - |
| Build | `npm run build` | Not run | - |
| Browser | Manual operation | Not run | - |

## Incomplete items

- Not started

## Issues and decisions

- None

## Stop conditions

Stop work when any of the following conditions is met:

- All automated checks pass and all browser checks that can be performed are complete.
- The specification is contradictory and work cannot proceed with a reasonable assumption.
- A required operation exceeds the authorized scope.
- The same cause produces three consecutive failures and work cannot proceed without more information.
