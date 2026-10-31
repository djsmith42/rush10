# Rush 10 end-to-end tests

```
pnpm test:e2e                          # everything (about 1.5 minutes)
pnpm test:e2e --grep-invert @animation # skip the GIF tests
pnpm test:e2e 04-laying                # one file
pnpm test:e2e -g "Skip"                # tests whose title matches
```

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
- Needs `ffmpeg` on the PATH and Playwright's Chromium (`pnpm exec playwright install chromium`).
