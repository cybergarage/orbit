# Memory Matching Game Test Plan

## Test approach

Verify game state transitions with Vitest unit tests. Use a fixed card order so tests do not depend on randomness. Verify DOM appearance and interaction in a browser.

## Automated tests

### Initial state

- There are 16 cards.
- There are two cards for each of eight symbols.
- Every card is face down.
- The move count is 0.
- The game is not complete.
- Input is not locked.

### First selection

- Selecting a face-down card turns it face up.
- Selecting only the first card does not increase the move count.
- Selecting the same card again does not change the state.
- Selecting a matched card does not change the state.

### Match

- Selecting two cards with the same symbol marks them as matched.
- Selecting the second card increases the move count by one.
- Matched cards remain face up.
- The next card can be selected after evaluation.

### Mismatch

- Selecting two cards with different symbols locks input.
- Selecting the second card increases the move count by one.
- Selecting another card while input is locked does not change the state.
- Use `vi.useFakeTimers()` to reproduce an 800-millisecond delay without waiting in real time.
- After 799 milliseconds, both cards remain face up and input remains locked.
- At 800 milliseconds, both cards turn face down.
- Resolving a mismatch turns both cards face down.
- Resolving a mismatch unlocks input.

### Game complete

- Matching the final pair completes the game.
- The final move count remains available after completion.

### Reset

- Every card turns face down.
- The move count becomes 0.
- The selection state is cleared.
- Input is unlocked.
- The game-complete state is cleared.
- The game can be initialized with a supplied card order.

## Command verification

Verify that all of the following commands complete with exit code 0:

```console
npm run typecheck
npm test
npm run build
```

## Browser verification

- Sixteen cards are displayed in a 4-by-4 grid.
- Matching and mismatching behavior can be verified.
- Mismatched cards remain visible for approximately 800 milliseconds.
- The move count is reflected on the screen.
- A completion message appears when all cards are matched.
- A new game can be started after a reset.
- Cards and reset can be operated using only the keyboard.
- Assistive-technology labels distinguish face-down, face-up, and matched states.
- The label of a face-down card does not reveal its symbol.
- No horizontal scrolling occurs at a width of 320 pixels.

Do not mark browser checks as complete based only on successful automated tests.
