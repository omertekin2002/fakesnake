Original prompt: Can you add a start screen so the player isn't immidiately put in the game after opening the website

- Added a start screen gate so the client no longer connects to Socket.IO on initial page load.
- Introduced explicit client phases: `menu`, `connecting`, `playing`, and `dead`.
- Added a `render_game_to_text` helper to expose concise UI state for browser validation.
- Fixed TypeScript config so `npm run lint` ignores generated files in `dist/`.
- Browser validation passed: initial load shows the start screen and clicking `Start Game` transitions into live play.
- Added an inline favicon to eliminate the default `favicon.ico` 404 during local/browser validation.
- Reworked the menu to use the actual game grid and floating food blobs instead of copy-heavy UI cards.
- Simplified the start screen overlay to just the game title and a basic start button.
- Revalidated in-browser: initial state stays in `menu`, the DOM only shows title + button, and `Start Game` still enters `playing`.
- Added an in-game `Exit` button and an `Escape` shortcut that both return the player to the start screen.
- Revalidated in-browser: both the on-screen `Exit` button and the `Escape` key return from live play back to `menu`.
- Moved the in-game score label lower so it no longer overlaps the top-left `Exit` button.
- Moved the in-game score label to the bottom-left corner to fully separate it from the top-left `Exit` button.
- TODO: If we later want keyboard-friendly menu navigation, add an Enter key handler for `Start Game`.
