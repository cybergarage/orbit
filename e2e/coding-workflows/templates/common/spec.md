# Memory Matching Game Specification

## Goal

Create a single-player memory matching game that runs in a browser. It must run entirely from the starter project without an additional server or external API.

## Technical requirements

- Use TypeScript, HTML, and CSS.
- Do not add a UI framework.
- Run on the Vite development server.
- Separate game state transitions from DOM operations.
- Structure game state transitions so they can be tested with Vitest.
- Keep mismatched cards visible with the standard `setTimeout` and `clearTimeout` functions, and structure the code so Vitest fake timers can reproduce elapsed time.
- `npm run typecheck`, `npm test`, and `npm run build` must succeed.

## Board

- Display 16 cards in a 4-by-4 grid.
- Use two cards for each of eight symbols.
- Represent symbols without external resources, for example with Unicode emoji.
- Shuffle the cards at the start of a game and after a reset.
- Allow tests to specify the card order explicitly.
- Allow initialization to receive a deck with a fixed order.
- Shuffle only when starting a normal game without a supplied deck.

## Card states

Each card has one of the following states:

- Face down
- One face-up card, after the first card is selected and before the second card is selected
- Face-up and awaiting evaluation, while two mismatched cards are visible and no other card can be selected
- Matched

## Selecting cards

- Selecting a face-down card turns it face up.
- Selecting a matched card does not change the state.
- Selecting an already face-up card again does not change the state.
- While cards are face up and awaiting evaluation, selecting another card does not change the state.
- The first and second selections must be different cards.
- Increase the move count by one when the second card is selected.

## Match

- If the two symbols are the same, mark both cards as matched.
- Matched cards remain face up.
- After determining a match, mark the cards as matched immediately without a delay.
- Allow the player to select the next card.

## Mismatch

- If the two symbols differ, display both cards for 800 milliseconds.
- Do not allow another card to be selected while the two cards are displayed.
- Turn both cards face down after 800 milliseconds.
- Then allow the player to select the next card.

## Game complete

- Complete the game when all eight pairs are matched.
- Display that the game is complete.
- Display the final move count.

## Reset

- Display a reset button.
- Reset the cards, move count, selection state, input lock, and game-complete state.
- Cancel any timer that is waiting to evaluate cards.
- When the reset button is selected, start a new game with a newly shuffled card order.
- Allow tests to reset with a supplied deck whose order is fixed.

## Screen

- Display the game title.
- Display the current move count.
- Display the 4-by-4 grid of cards.
- Display the reset button.
- Display a message when the game is complete.
- Remain usable at a screen width of 320 pixels without horizontal scrolling.

## Accessibility

- Use `button` elements for cards and reset.
- Allow cards to be selected using only the keyboard.
- Add labels that allow assistive technology to distinguish card states.
- Do not include symbol information in the label of a face-down card.
- Do not communicate card state through color alone.

## Out of scope

- Multiplayer
- Online rankings
- User registration
- Data persistence
- Backend
- Sound effects
- External images or external APIs

## Completion criteria

- Satisfy all required items in this specification.
- Pass the automated tests described in `test.md`.
- Pass the type-check and build.
- Verify basic operation and the responsive layout in a browser.
