import { act, dragTo, expect, hand, pick, seed, stored, test, type MeldSpec } from '../lib/harness';
import type { Page } from '@playwright/test';

// Animation tests run with motion enabled and attach GIFs; everything else runs with reduced motion.
// This file is numbered 00 so its slow tests start first and overlap the quick ones; the album lists it last.
const ANIMATE = { animate: true } as const;
const AVA = ['R1', 'B4', 'G7', 'Y10', 'R12', 'B2', 'G9', 'Y5', 'R3', 'B11'];
const BEN = ['G1', 'Y4', 'R8', 'B10', 'G12', 'Y2', 'R9', 'B5', 'G3', 'Y11'];
const hidden = (page: Page) => page.locator('[data-testid^="card-in-hand-"].opacity-0');
const flights = (page: Page) => page.locator('body > div.fixed.z-\\[120\\], body div[aria-hidden].pointer-events-none.fixed.left-0.top-0');

// Rendering animations is CPU-heavy, so they run as two sequential lanes instead of crowding every worker.
test.describe('Animations: moving cards @animation', () => {
  test.describe.configure({ mode: 'default' });

  test('page transitions: home → name → lobby', async ({ h }) => {
    test.setTimeout(45_000);
    const page = await h.open(undefined, ANIMATE);
    const stage = page.locator('.route-stage');
    await expect(stage).toHaveAttribute('data-transition', 'idle', { timeout: 10_000 });
    await h.gif(page, 'Create a game', async () => {
      await page.getByTestId('button-create-room').click();
      await expect(page.getByTestId('input-player-name')).toBeVisible({ timeout: 8000 });
      await expect(stage).toHaveAttribute('data-transition', 'idle', { timeout: 8000 });
      await page.getByTestId('input-player-name').fill('Ava');
      await page.getByTestId('button-enter-name').click();
      await expect(page.getByText('Invite players to join')).toBeVisible({ timeout: 8000 });
      await expect(stage).toHaveAttribute('data-transition', 'idle', { timeout: 8000 });
    }, { width: 520 });
  });

  test('starting a game: lobby exit, then cards dealt one at a time', async ({ h }) => {
    const g = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, { ...ANIMATE, waitFor: 'lobby' });
    await ava.waitForTimeout(800);
    const inFlight = new Set<number>();
    await h.gif(ava, 'Start game and deal', async () => {
      await ava.getByTestId('button-start-game').click();
      await expect(ava.locator('[data-testid^="card-in-hand-"]')).toHaveCount(10, { timeout: 8000 });
      for (let i = 0; i < 100; i++) {
        const count = await hidden(ava).count();
        inFlight.add(count);
        if (count === 0) break;
        await ava.waitForTimeout(80);
      }
    }, { tailMs: 600 });
    // Cards land one at a time, so the deal passes through partly-dealt hands.
    expect([...inFlight].filter(n => n > 0 && n < 10).length).toBeGreaterThanOrEqual(3);
    expect(inFlight.has(0)).toBe(true);
    await h.snap(ava, 'Dealt');
  });

  test('draw from the draw pile: the card flies to the right end of the hand', async ({ h }) => {
    const g = seed({ players: [{ name: 'Ava', hand: AVA }, { name: 'Ben', hand: BEN }], draw: ['R1', 'W'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await ava.waitForTimeout(250);
    await h.gif(ava, 'Draw from the deck', async () => {
      await ava.getByTestId('button-draw-deck').click();
      await expect(hand(ava, 'W_1')).toBeAttached();
      await expect(hidden(ava)).toHaveCount(0, { timeout: 4000 });
    });
    const order = await ava.locator('[data-testid^="card-in-hand-"]').evaluateAll(n => n.map(e => e.getAttribute('data-testid')));
    expect(order.at(-1)).toBe('card-in-hand-W_1');
    const overflow = await ava.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('draw from the discard pile: the next card is revealed as it leaves', async ({ h }) => {
    const g = seed({ players: [{ name: 'Ava', hand: AVA }, { name: 'Ben', hand: BEN }], discard: ['G6', 'Y8'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await ava.waitForTimeout(250);
    await h.gif(ava, 'Draw from the discard pile', async () => {
      await ava.getByTestId('button-draw-discard').click();
      await expect(hand(ava, 'Y8_1')).toBeAttached();
      await expect(hidden(ava)).toHaveCount(0, { timeout: 4000 });
    });
  });

  test("an opponent's draw and discard fly between the piles and their seat", async ({ h }) => {
    const g = seed({ players: [{ name: 'Ava', hand: AVA }, { name: 'Ben', hand: BEN }], draw: ['R1', 'B6'] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] }, ANIMATE);
    await ben.waitForTimeout(250);
    await h.gif(ben, "Ben watches Ava draw, then discard", async () => {
      await act(g.code, g.seats[0], 'draw-deck');
      await ben.waitForTimeout(1600);
      await act(g.code, g.seats[0], 'discard', { cardIds: ['Y10_1'] });
      await expect(ben.getByTestId('text-turn-status')).toHaveText('Your turn. Draw a card.', { timeout: 5000 });
      await ben.waitForTimeout(1200);
    });
  });

  test('discard by button: the card flies to the pile without a duplicate landing early', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [{ name: 'Ava', hand: AVA }, { name: 'Ben', hand: BEN }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await ava.waitForTimeout(250);
    await pick(ava, 'Y10_1');
    await ava.waitForTimeout(400);
    await h.gif(ava, 'Discard the yellow 10', async () => {
      await ava.getByTestId('button-discard').click();
      await expect(ava.getByTestId('text-turn-status')).toContainText('Ben is', { timeout: 4000 });
      await ava.waitForTimeout(1200);
    });
  });

  test('discard by dragging onto the pile', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [{ name: 'Ava', hand: AVA }, { name: 'Ben', hand: BEN }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await ava.waitForTimeout(250);
    await h.gif(ava, 'Drag the green 7 to the discard pile', async () => {
      await dragTo(ava, hand(ava, 'G7_1'), ava.locator('[data-pile="discard"]'));
      await expect.poll(() => stored(g.code).discardPile.at(-1).id).toBe('G7_1');
      await ava.waitForTimeout(1200);
    });
  });

  test('hover spreads the hand; selection lifts and enlarges cards', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [{ name: 'Ava', hand: AVA }, { name: 'Ben', hand: BEN }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await ava.waitForTimeout(250);
    await h.gif(ava, 'Hover across the hand, then select', async () => {
      const first = (await hand(ava, 'R1_1').boundingBox())!;
      const last = (await hand(ava, 'B11_1').boundingBox())!;
      const y = first.y + first.height * 0.4;
      for (let x = first.x + 10; x < last.x + last.width; x += 40) {
        await ava.mouse.move(x, y);
        await ava.waitForTimeout(60);
      }
      await pick(ava, 'G9_1');
      await ava.waitForTimeout(250);
      await pick(ava, 'B2_1');
      await ava.waitForTimeout(700);
    });
  });

});

test.describe('Animations: table moments @animation', () => {
  test.describe.configure({ mode: 'default' });

  test('drag to reorder the hand', async ({ h }) => {
    const g = seed({ players: [{ name: 'Ava', hand: AVA }, { name: 'Ben', hand: BEN }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await ava.waitForTimeout(250);
    await h.gif(ava, 'Drag the red 1 to the right', async () => {
      await dragTo(ava, hand(ava, 'R1_1'), hand(ava, 'R3_1'));
      await ava.waitForTimeout(800);
      await ava.getByTestId('button-sort-hand').click();
      await ava.waitForTimeout(900);
    });
  });

  test('laying down a level: the piles flip in', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [{ name: 'Ava', hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9', 'G2', 'Y3', 'R12', 'B12', 'Y6'] }, { name: 'Ben', hand: BEN }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    const ben = await h.open({ code: g.code, seat: g.seats[1] }, ANIMATE);
    await pick(ava, 'R5_1', 'B5_1', 'G5_1', 'R9_1', 'Y9_1', 'B9_1');
    await ava.waitForTimeout(600);
    await h.gif(ava, 'Ava lays her level', async () => {
      await ava.getByTestId('button-lay-phase').click();
      await expect(ava.locator(`[data-meld-zone="${g.seats[0].id}"] [data-drop-meld]`)).toHaveCount(2);
      await ava.waitForTimeout(1400);
    });
    await h.gif(ben, "Ben sees Ava's level arrive", async () => {
      await expect(ben.locator(`[data-meld-zone="${g.seats[0].id}"] [data-drop-meld]`)).toHaveCount(2, { timeout: 4000 });
      await ben.waitForTimeout(1600);
    });
  });

  test('adding to a pile: valid piles pulse, and the card flies in', async ({ h }) => {
    const melds: MeldSpec[] = [
      { id: 'ava-7s', owner: 0, type: 'group', cards: ['R7', 'B7', 'G7'] }, { id: 'ava-11s', owner: 0, type: 'group', cards: ['R11', 'B11', 'G11'] },
      { id: 'ben-run', owner: 1, type: 'sequence', cards: ['Y3', 'B4', 'G5', 'R6'] }, { owner: 1, type: 'group', cards: ['R10', 'Y10', 'G10'] },
    ];
    const g = seed({ turnState: 'discard', melds, players: [
      { name: 'Ava', hand: ['Y7', 'W', 'B9', 'Y12', 'R2'], hasLaidPhase: true }, { name: 'Ben', hand: BEN, phase: 2, hasLaidPhase: true }, { name: 'Cleo', hand: ['G4'] },
    ] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await ava.waitForTimeout(250);
    await h.gif(ava, 'Drag the yellow 7 onto the 7s, then click-add a Wild', async () => {
      await dragTo(ava, hand(ava, 'Y7_1'), ava.getByTestId('button-hit-ava-7s'), { release: false });
      await ava.waitForTimeout(1000);
      await ava.mouse.up();
      await expect(ava.getByTestId('button-hit-ava-7s').locator('[data-meld-card]')).toHaveCount(4);
      await ava.waitForTimeout(900);
      await pick(ava, 'W_1');
      await ava.waitForTimeout(900);
      await ava.getByTestId('button-hit-ben-run').click();
      await expect(ava.getByTestId('button-hit-ben-run').locator('[data-meld-card]')).toHaveCount(5);
      await ava.waitForTimeout(900);
    });
  });

  test('Skip announcement: centred for about two seconds', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [{ name: 'Ava', hand: [...AVA, 'S'] }, { name: 'Ben', hand: BEN }] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] }, ANIMATE);
    await ben.waitForTimeout(250);
    // Time it in the page, so test-runner latency under load doesn't count.
    await ben.evaluate(() => {
      const w = window as unknown as { skipShown?: number; skipGone?: number };
      new MutationObserver(() => {
        const shown = !!document.querySelector('[data-testid="skip-announcement"]');
        if (shown && w.skipShown === undefined) w.skipShown = performance.now();
        if (!shown && w.skipShown !== undefined && w.skipGone === undefined) w.skipGone = performance.now();
      }).observe(document.body, { childList: true, subtree: true });
    });
    await h.gif(ben, 'Ava skips Ben', async () => {
      await act(g.code, g.seats[0], 'discard', { cardIds: ['S_1'] });
      await expect(ben.getByTestId('skip-announcement')).toBeVisible({ timeout: 4000 });
      await expect(ben.getByTestId('skip-announcement')).toHaveCount(0, { timeout: 5000 });
    });
    const shownMs = await ben.evaluate(() => {
      const w = window as unknown as { skipShown: number; skipGone: number };
      return w.skipGone - w.skipShown;
    });
    await h.note('Announcement shown for', `${Math.round(shownMs)} ms`);
    expect(shownMs).toBeGreaterThan(1800);
    expect(shownMs).toBeLessThan(2400);
  });

  test('round results: the table dims and the results zoom in', async ({ h }) => {
    const g = seed({ turnState: 'discard', melds: [{ owner: 0, type: 'group', cards: ['R7', 'B7', 'G7'] }, { owner: 0, type: 'group', cards: ['R9', 'B9', 'G9'] }],
      players: [{ name: 'Ava', hand: ['G4'], hasLaidPhase: true }, { name: 'Ben', hand: ['W', 'S', 'R12'] }, { name: 'Cleo', hand: ['R1'] }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await pick(ava, 'G4_1');
    await ava.waitForTimeout(400);
    await h.gif(ava, 'Last card discarded', async () => {
      await ava.getByTestId('button-discard').click();
      await expect(ava.getByTestId('dialog-round-over')).toBeVisible();
      await ava.waitForTimeout(1800);
    });
  });

  test('winning the game: confetti', async ({ h }) => {
    const g = seed({ turnState: 'discard', melds: [{ owner: 0, type: 'group', cards: ['R7', 'B7', 'G7', 'Y7', 'W'] }, { owner: 0, type: 'group', cards: ['R2', 'B2', 'G2'] }],
      players: [{ name: 'Ava', hand: ['G4'], hasLaidPhase: true, phase: 10 }, { name: 'Ben', hand: ['R1'], phase: 7, score: 85 }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await ava.waitForTimeout(400);
    await h.gif(ava, 'Ava wins', async () => {
      await act(g.code, g.seats[0], 'discard', { cardIds: ['G4_1'] });
      await expect(ava.getByTestId('text-game-over')).toBeVisible({ timeout: 4000 });
      await ava.waitForTimeout(2200);
    });
  });

  test('draw-pile arrows bounce on your turn', async ({ h }) => {
    const g = seed({ players: [{ name: 'Ava', hand: AVA }, { name: 'Ben', hand: BEN }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    const arrow = ava.getByTestId('button-draw-deck').locator('.pile-turn-arrow');
    await expect(arrow).toBeVisible();
    const duration = await arrow.evaluate(el => getComputedStyle(el).animationDuration);
    expect(duration).toBe('1s');
    await h.gif(ava, 'Idle on your turn', async () => { await ava.waitForTimeout(2200); }, { tailMs: 0 });
  });

  test('a bot turn, as another player sees it', async ({ h }) => {
    const g = seed({ current: 1, players: [{ name: 'Ava', hand: AVA }, { name: 'Botley', hand: BEN, isBot: true }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, ANIMATE);
    await h.gif(ava, 'Botley draws and discards', async () => {
      await expect(ava.getByTestId('text-turn-status')).toHaveText('Your turn. Draw a card.', { timeout: 10_000 });
      await ava.waitForTimeout(1200);
    });
  });

  test('picking an avatar plays its gesture', async ({ h }) => {
    const g = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, { ...ANIMATE, waitFor: 'lobby' });
    await ava.waitForTimeout(1500);
    const taken = new Set(stored(g.code).players.map((p: { avatar: string }) => p.avatar));
    const choices = ['fox', 'cat', 'bear', 'rabbit', 'owl', 'panda', 'frog', 'penguin'].filter(kind => !taken.has(kind)).slice(0, 2);
    await h.gif(ava, 'Pick two avatars', async () => {
      for (const kind of choices) {
        await ava.getByTestId(`button-avatar-${kind}`).click();
        await expect.poll(() => stored(g.code).players[0].avatar).toBe(kind);
        await ava.waitForTimeout(700);
      }
    });
  });

  test('reduced motion: the deal appears at once', async ({ h }) => {
    const g = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] }, { waitFor: 'lobby' });
    await ava.getByTestId('button-start-game').click();
    await expect(ava.locator('[data-testid^="card-in-hand-"]')).toHaveCount(10);
    await expect(hidden(ava)).toHaveCount(0);
    await expect(flights(ava)).toHaveCount(0);
    await h.snap(ava, 'All ten cards, no flights');
  });
});
