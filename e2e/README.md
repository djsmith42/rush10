# Rush 10 end-to-end tests

```
pnpm test:e2e                          # everything (about 2.5 minutes)
pnpm test:e2e 04-laying                # one file
pnpm test:e2e -g "Skip"                # tests whose title matches (one pass)
pnpm test:e2e -g @animation            # only the animation tests
```

`pnpm test:e2e` runs in two phases into one album: the functional tests first (6 at once, reduced motion),
then the `@animation` tests with only 3 browsers, because frame timing means nothing when the machine is
saturated.

The album is written to `e2e-report/index.html`: one expandable entry per test, with its screenshots,
GIFs for animation tests, and the error for failures. `e2e-report/artifact.html` is the same page with
absolute image paths.

How it works:

- Playwright starts its own API on port 3031, with a fresh database at `.data/e2e/rush10.db`, and builds
  and serves the frontend on port 5191. Production and the dev servers are never touched.
- Most tests write the exact game they need straight into that database (`seed` in `lib/harness.ts`):
  the hands, piles, laid-down piles, levels and whose turn it is. Card ids are `<card>_<n>`, e.g.
  `R5_1` is the first red 5, `W_2` the second Wild, `S_1` the first Skip.
- Each browser gets its own client address (`X-Forwarded-For`) so the API's per-IP rate limits never trip.
- Tests run with reduced motion except the `@animation` ones, which record GIFs with ffmpeg.
- Every GIF recording is also checked frame by frame (`lib/motion.ts`). It samples every card on screen
  (hand, flights, piles, laid cards, opponents' fans) on each animation frame and fails the test for:
  - **teleports**: a card covering 48px+ in one frame, at more than 3× the speed of the two frames on
    either side (easing ramps; a jump spikes);
  - **pop-ins / vanishes**: a card going from invisible to fully visible (or back) in one frame with no
    other card there to hand over to;
  - **shadow snaps**: a blurred shadow switching on at full strength in one frame;
  - **duplicates**: a card in flight whose face is already showing on the pile or laid pile it is
    flying to;
  - **stalls**: a frame over 200ms (`E2E_STALL_MS`) while cards are moving.
  The motion summary for each recording is in the album. A self-test plants each problem on a page and
  checks the detector catches it.
- Needs `ffmpeg` on the PATH and Playwright's Chromium (`pnpm exec playwright install chromium`).
