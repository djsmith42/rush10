You are taking over maintenance of Rush 10, an existing web-based multiplayer card game. Read the code before changing anything. Preserve working behavior and make targeted changes rather than redesigning or rewriting the application.

Your first task is to familiarize yourself with the project, verify the local setup, and report any discrepancies or blockers. Do not automatically migrate databases, deploy, reset games, or implement speculative improvements.

PRODUCT AND TERMINOLOGY

Rush 10 is based on Phase 10, with deliberate custom rules and terminology:

- Say “Level,” never “Phase,” in player-facing text.
- Say “Group,” not “Set.”
- Say “Sequence,” not “Run.”
- Say “Game,” not “Table,” in player-facing text.
- Avoid exposing the word “meld” to players. Internal identifiers may still use meld, phase, and table; do not rename these wholesale.
- Supports 2–6 players.
- Room codes are four uppercase characters from a restricted, unambiguous alphabet.
- Frontend game URLs are /game/:code. The older /room/:code route redirects.
- API endpoints still use /api/rush10/rooms. Do not rename them merely to match frontend terminology.

CUSTOM GAME RULES — IMPORTANT

These override assumptions about the original game:

1. A round ends immediately when either:
   - Any player has no cards left, including after laying their level or adding cards to an existing pile.
   - All players have completed their current level.

2. Nobody may draw a Skip from the discard pile.
   - This supersedes an earlier, narrower rule about drawing your own Skip in a two-player game.
   - Disable the discard-pile interaction and hover animation when its top card is a Skip.
   - Do not show its bouncing draw arrow.
   - Explain: “You can't draw a Skip from the discard pile”.
   - Enforce this on the server, not just in the UI.
   - Drawing a Skip from the draw deck is not prohibited.

3. In a two-player game, discarding a Skip skips the opponent and returns the turn to the discarding player.
   - Explain why it is their turn again.
   - A Skip announcement names the acting player and target, appears centrally for two seconds, and is shown to connected players.
   - Do not replay historical Skip announcements on refresh.

4. Players may add cards to their own or another player’s laid-down piles during the same turn they lay down their level, provided the round has not already ended.

5. Multiple selected cards may be added to one pile in a single move only if ALL of them fit.
   - Validate the selection as a batch.
   - Never partially play an invalid batch.
   - Sequence extensions must account for ordering, both ends, Wilds, duplicate numbers, gaps, and the 1–12 bounds.
   - Discarding still requires exactly one card.

6. Only legal destinations should highlight. The server remains authoritative.

Check the existing scoring and winner logic before making changes. Do not infer a new winner rule solely from leaderboard ordering.

PROJECT STRUCTURE

This is a pnpm TypeScript monorepo:

- artifacts/rush-10/
  React + Vite frontend, Tailwind styling, Framer Motion animations.
- artifacts/api-server/
  Express API, built with esbuild.
- lib/api-spec/
  OpenAPI contract and Orval generation configuration.
- lib/api-client-react/
  Generated API client, types, and React Query hooks.
- lib/api-zod/
  Generated server request/response schemas.
- lib/db/
  SQLite (better-sqlite3) connection and Drizzle schema.
- artifacts/mockup-sandbox/
  Existing design-preview workspace; not the production game.
- scripts/
  Workspace support scripts.

Useful entry points:

- artifacts/rush-10/src/App.tsx
  Home page, waiting room, routes, room fetching, mutations, notifications.
- artifacts/rush-10/src/components/game/game-table.tsx
  Main game interactions, selection, drag/drop targets, results display.
- artifacts/rush-10/src/components/ordered-hand.tsx
  Hand geometry, ordering, dragging, selection, drawing and dealing.
- artifacts/rush-10/src/components/game/seat.tsx
  Player identities, opponent fans, laid-down piles.
- artifacts/rush-10/src/components/game/event-flights.tsx
  Shared game-event animations.
- artifacts/rush-10/src/components/game/skip-splash.tsx
  Skip announcement.
- artifacts/rush-10/src/lib/meld-recognition.ts
  Automatic objective recognition from selected cards.
- artifacts/rush-10/src/lib/hit-target.ts
  Client validation of legal destinations.
- artifacts/rush-10/src/lib/laid-card-order.ts
  Sequence display ordering and Wild placement.
- artifacts/rush-10/src/index.css
  Visual styles and responsive layouts.
- artifacts/api-server/src/routes/rush10.ts
  Game rules, actions, room views, scoring, round transitions.
- artifacts/api-server/src/lib/room-store.ts
  Durable room storage and transaction locking.

Treat these as orientation pointers; confirm the actual current files and behavior.

PERSISTENCE AND MULTIPLAYER

- Games are stored in a SQLite file (DATABASE_PATH) and must survive server restarts and redeploys.
- Do not introduce automatic room expiration or reset existing games without explicit permission.
- Room mutations run inside a SQLite BEGIN IMMEDIATE transaction (write lock) and are committed before responding.
- Preserve protection against concurrent moves, lost updates, and partial mutations.
- The frontend polls for room updates. Do not assume WebSockets are implemented.
- Player access uses saved browser-local session tokens, not conventional user accounts.
- Tokens are credentials: do not log them or expose them in documentation or screenshots.
- Moving to a different domain does not automatically transfer browser-local sessions.

A previously reported bug left a round active after a player emptied their hand onto a laid pile. The code now has a shared round-completion check and recovery for saved games in that invalid state.
Preserve:
- Immediate round completion after the last card is played.
- Correct score and level updates.
- Idempotence: repeated requests/polls must not score a round twice.
- Recovery under a database lock.

SELECTION AND CARD INTERACTIONS

The user explicitly approved the following interaction model:

- Multi-select is always enabled; there is no mode toggle.
- Automatically recognize selected cards that meet level objectives.
- Show partial progress and a “Lay Down Cards” action when the complete selection is valid.
- Do not restore manual Type/Value/Color/Add Meld/Lay Level controls.
- “Sort my hand” and “By color” are always visible together.
- Cards can be reordered by dragging.
- Cards can also be dragged onto legal laid-down piles.
- Dragging a selected card uses the selected batch; dragging an unselected card uses that card.
- Invalid drops must not submit a play.
- Escape cancels dragging.
- Valid targets pulse with a halo, but their thick green outline stays solid.
- The discard action appears above a singly selected card, not at the bottom of the page.
- Clicking blank space clears selection.
- Hover and selection spread nearby cards; selected cards are visibly enlarged.

CARD ORDER AND ANIMATION PITFALLS

These have caused real bugs; preserve the fixes:

- Sequences display in numeric order with Wilds in the correct logical positions.
- Wilds render beneath numbered cards in stacking order, without changing their logical sequence positions.
- All players’ laid-down cards use the same size.
- Opponents’ concealed hand cards are smaller than the current player’s hand cards.

Hand geometry:
- Use consistent width measurements. Mixing ResizeObserver content width with clientWidth caused resize loops and restarted animations.
- Calculate flight destinations from final slot geometry, not temporarily transformed card rectangles.
- Keep flying overlays out of document layout.
- Do not force horizontal scrolling when a drawn card arrives.
- Account for rotated corners, selection enlargement, and hover spread when keeping cards within the viewport.
- Changes to card dimensions must also affect flight destination calculations.

Animation timing:
- New cards join the right side of the hand.
- Dealing animates one card at a time, staggered by 0.2 seconds, using the normal card-flight speed.
- When drawing from the discard pile, remove its top card and reveal the next card or empty state as the flight begins.
- When a discarded card flies into the discard pile, do not show a duplicate at the destination before it lands.
- Draw-pile arrows bounce once per second.
- Respect reduced-motion preferences.

VISUAL DIRECTION

Preserve the established playful, open card-game layout:
- Dark midnight/slate background.
- Light ceramic card faces with vivid colored numbers.
- Purple/pink Wild styling, orange Skip cards, violet patterned backs.
- Lime green active-player and legal-action accents.
- Avoid dashboard-style boxes around the main game or lobby.
- Individual home-page level summaries are intentionally boxed.

Card typography:
- Numbers are colored directly, with no rectangular number badges.
- Orange/amber number ink must remain readable on white.
- Bangers is the chosen open-font substitute for the requested card lettering style.
- The 7 has a custom treatment to distinguish it from 1.
- Do not restore a slash through the Wild’s W.

Responsive layout:
- Short windows use reduced spacing and smaller hand cards.
- Short, wide windows place opponents beside the draw piles to save height.
- Keep controls reachable; do not hide overflow merely to claim everything fits.
- Taller windows retain the roomier layout.

Home page:
- Preserve the RUSH 10 hero and animated card fan.
- The top of the fan aligns approximately with the top of the hero title.
- Top padding is small, with no extra section padding above “Enter your Name”.
- Separate name entry from the unboxed Create/Join choices.
- Keep reconnect beneath the Join controls.
- Pressing Enter in the NAME field must do NOTHING.
- Creating a game uses an explicit button, not an implicitly submitted form.
- Enter in the GAME CODE field still joins.
- A nonexistent code shows “There's no game with that code” under the join controls, not a raw HTTP error.

Lobby:
- Unique available avatars are randomly assigned when players enter the waiting room.
- Explicit choices must not duplicate another player’s avatar.
- Avatars have individual subtle gestures.
- Do not restore removed captions, player-count labels, or Quick Guide panels.

Background:
- Home and lobby share a dense, blurred, darkened decorative card background.
- It is noninteractive.
- Sustained low measured frame rate pauses its animation for the tab session.
- Ignore hidden-tab throttling and initial loading when measuring.
- This policy applies to decorative background cards, not all gameplay animations.

ROUND RESULTS

- Darken and slightly blur the game behind the results.
- Keep the results themselves sharp.
- Block interaction with the background and hide hand sorting.
- Heading: “Round N Complete”.
- Explain the cause below the heading:
  - “[Name] played all their cards.”
  - “All players completed their level.”
- Sort score rows LOWEST to HIGHEST.
- The first player’s score is yellow and larger than the other scores.
- No numbered rankings or dividing lines between players.
- Preserve outlined/shadowed, readable result text.

NOTIFICATIONS

- Do not show “[Name] drew a card.”
- Waiting-for-players and verbose round-ended explanation banners were intentionally suppressed.
- The user has removed substantial decorative copy. Do not add it back.
- Keep useful errors visible; do not silently swallow request failures.

DEVELOPMENT AND VERIFICATION

Use pnpm, not npm or yarn.

Typical commands from the workspace root:
- pnpm install --frozen-lockfile
- pnpm run typecheck:libs
- pnpm --filter @workspace/rush-10 typecheck
- pnpm --filter @workspace/api-server typecheck
- pnpm --filter @workspace/rush-10 test
- pnpm --filter @workspace/api-spec codegen

API regression scripts are in artifacts/api-server/tests/.
Inspect their setup before running them, especially any database-persistence test.
Focused scripts include:
- node artifacts/api-server/tests/skip-redraw.mjs
- node artifacts/api-server/tests/multi-hit.mjs
- node artifacts/api-server/tests/round-completion.mjs

Testing cautions:
- /test/play (game in progress, 2–6 players, random levels and scores) and /test/end (finished game, chosen end reason) are testing routes with a perspective-switch toolbar. Each seeds a brand-new room via POST /rush10/test-rooms; /test lists them; /test-game redirects to /test.
- Never alter real player games to construct a test.
- Some prior browser tests used mocked room/action responses to verify drag/drop UI behavior. They do not establish full end-to-end persistence correctness.
- Some server regression tests extract and execute route logic; do not treat those as full HTTP/database integration tests.
- Test changed flows proportionally, particularly last-card plays, multi-card plays, reconnection, and animations.

API CODEGEN GOTCHA

Change the OpenAPI contract first when altering API shapes, then regenerate.
Orval may append a broad export from generated/api to lib/api-zod/src/index.ts.
That can collide with generated parameter type names, notably GetRush10RoomParams.
Preserve the curated explicit schema exports and resolve the barrel collision after generation. Do not abandon generation or patch only generated interfaces.

HOSTING

Production runs at https://thesmithfam.org/rush10 behind Apache on this server:
- Node 24 lives in /opt/node24 (the system Node is too old). pnpm 10 is pinned via packageManager.
- API: systemd service rush10, bound to 127.0.0.1:3010, with NODE_ENV=production, PORT, HOST and DATABASE_PATH set.
- Database: /var/lib/rush10/rush10.db, outside any web-served directory. The API creates the table on startup.
- Frontend is built with BASE_PATH=/rush10/ and copied to /home/vhosts/thesmithfam.org/rush10; Apache provides SPA fallback.
- Apache proxies /rush10/api to the API; plain HTTP redirects /rush10 to HTTPS.
- Config files and the deploy logic are in scripts/deploy/. Redeploy with ./deploy.
- Database backups are not yet configured.
- Do not expose test tooling publicly without reviewing its suitability.
- Player sessions are browser-local and do not transfer between domains.

WORKING STYLE

- The user prefers incremental, specific changes.
- Implement what was requested, not unrelated redesigns.
- Preserve the latest custom rules over older instructions or original-game assumptions.
- Explain findings plainly and distinguish confirmed bugs from hypotheses.
- Do not claim production is fixed merely because local code changed.
- Ask before destructive actions, public repository uploads, database changes affecting existing data, or deployments.

FIRST RESPONSE

After inspecting the workspace:
1. Summarize the architecture and how to run it locally.
2. Identify missing configuration without requesting secrets in chat.
3. Flag stale documentation or obvious setup problems.
4. Confirm you understand the custom round-ending and Skip rules.
5. Wait for the next maintenance request unless the user has already assigned one.  
