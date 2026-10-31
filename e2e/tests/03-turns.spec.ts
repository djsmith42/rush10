import { act, api, dragTo, grabPoint, expect, hand, handOrder, pick, rig, seed, stored, test, turnStatus, type SeedSpec } from '../lib/harness';

const AVA = ['R1', 'B4', 'G7', 'Y10', 'R12', 'B2', 'G9', 'Y5', 'R3', 'B11'];
const BEN = ['G1', 'Y4', 'R7', 'B10', 'G12', 'Y2', 'R9', 'B5', 'G3', 'Y11'];
const duel = (over: Partial<SeedSpec> = {}, ava = AVA, ben = BEN) =>
  seed({ players: [{ name: 'Ava', hand: ava }, { name: 'Ben', hand: ben }], ...over });

test.describe('Drawing', () => {
  test('draw from the draw pile', async ({ h }) => {
    const game = duel({ draw: ['R1', 'R2', 'B9'] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    const ben = await h.open({ code: game.code, seat: game.seats[1] });
    await expect(turnStatus(ava)).toHaveText('Your turn. Draw a card.');
    await expect(turnStatus(ben)).toContainText('Ava is drawing');
    await h.snap(ava, 'Before drawing: both piles live');
    await ava.getByTestId('button-draw-deck').click();
    await expect(hand(ava, 'B9_1')).toBeVisible();
    await expect(ava.locator('[data-testid^="card-in-hand-"]')).toHaveCount(11);
    await expect(turnStatus(ava)).toHaveText('Finish your turn: lay cards down, add to a pile, or discard');
    await expect(ava.getByTestId('button-draw-deck')).toBeDisabled();
    await expect(ava.getByTestId('button-draw-discard')).toBeDisabled();
    await h.snap(ava, 'Drew the blue 9');
    await expect(ben.getByRole('img', { name: 'Ava holds 11 cards' })).toBeVisible();
    await expect(turnStatus(ben)).toContainText('Ava is thinking');
    await h.snap(ben, 'Ben sees Ava holding 11');
  });

  test('draw from the discard pile', async ({ h }) => {
    const game = duel({ discard: ['G3', 'Y8'] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await h.snap(ava, 'Yellow 8 on the discard pile');
    await ava.getByTestId('button-draw-discard').click();
    await expect(hand(ava, 'Y8_1')).toBeVisible();
    expect(stored(game.code).discardPile.map((c: { id: string }) => c.id)).toEqual(['G3_2']);
    await h.snap(ava, 'Took the 8; green 3 revealed');
  });

  test('an empty discard pile cannot be drawn from', async ({ h }) => {
    const game = duel({ discard: [] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await expect(ava.getByTestId('button-draw-discard')).toBeDisabled();
    await expect(ava.getByTestId('button-draw-discard')).toContainText('Empty');
    const res = await act(game.code, game.seats[0], 'draw-discard');
    expect(res.json.error).toBe('There is no discard card to pick up.');
    await h.snap(ava, 'Empty discard pile');
  });

  test('only one draw per turn', async ({ h }) => {
    const game = duel();
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await ava.getByTestId('button-draw-deck').click();
    await expect(ava.getByTestId('button-draw-deck')).toBeDisabled();
    const res = await act(game.code, game.seats[0], 'draw-deck');
    expect(res.json.error).toBe('Draw one card before playing.');
    expect(stored(game.code).players[0].hand).toHaveLength(11);
    await h.snap(ava, 'Piles disabled after drawing');
  });

  test("cannot draw on someone else's turn", async ({ h }) => {
    const game = duel();
    const ben = await h.open({ code: game.code, seat: game.seats[1] });
    await expect(ben.getByTestId('button-draw-deck')).toBeDisabled();
    await expect(ben.getByTestId('button-draw-discard')).toBeDisabled();
    const res = await act(game.code, game.seats[1], 'draw-deck');
    expect(res.json.error).toBe('Wait for your turn.');
    await h.snap(ben, "Ben's piles are disabled");
  });

  test('a Skip on the discard pile cannot be drawn', async ({ h }) => {
    const game = duel({ discard: ['R4', 'S'] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await expect(ava.getByTestId('button-draw-discard')).toBeDisabled();
    await expect(ava.getByTestId('button-draw-discard').locator('.pile-turn-arrow')).toHaveCount(0);
    await expect(ava.getByTestId('button-draw-deck').locator('.pile-turn-arrow')).toHaveCount(1);
    await ava.locator('[data-drop-discard]').hover();
    await expect(ava.getByRole('tooltip')).toHaveText("You can't draw a Skip from the discard pile");
    await expect(ava.getByRole('tooltip')).toHaveCSS('opacity', '1');
    const res = await act(game.code, game.seats[0], 'draw-discard');
    expect(res.json.error).toBe("You can't draw a Skip from the discard pile");
    await h.snap(ava, 'Skip on top: tooltip, no arrow');
  });

  test('a Skip can be drawn from the draw pile', async ({ h }) => {
    const game = duel({ draw: ['R1', 'S'] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await ava.getByTestId('button-draw-deck').click();
    await expect(hand(ava, 'S_1')).toBeVisible();
    await h.snap(ava, 'Drew a Skip from the deck');
  });

  test('an empty draw pile reshuffles the discard pile', async ({ h }) => {
    const game = duel({ draw: [], discard: ['R1', 'B2', 'G3', 'Y4'] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await ava.getByTestId('button-draw-deck').click();
    await expect(ava.locator('[data-testid^="card-in-hand-"]')).toHaveCount(11);
    const room = stored(game.code);
    expect(room.discardPile.map((c: { id: string }) => c.id)).toEqual(['Y4_2']);
    expect(room.drawPile).toHaveLength(2);
    await h.snap(ava, 'Reshuffled; yellow 4 stays on the discard pile');
  });
});

test.describe('Discarding', () => {
  test('discard ends the turn and passes to the next player', async ({ h }) => {
    const game = duel({ turnState: 'discard' });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    const ben = await h.open({ code: game.code, seat: game.seats[1] });
    await pick(ava, 'Y10_1');
    await expect(ava.getByTestId('button-discard')).toBeVisible();
    await h.snap(ava, 'Discard button above the selected card');
    await ava.getByTestId('button-discard').click();
    await expect(hand(ava, 'Y10_1')).toHaveCount(0);
    await expect(turnStatus(ava)).toContainText('Ben is drawing');
    await expect(turnStatus(ben)).toHaveText('Your turn. Draw a card.');
    expect(stored(game.code).discardPile.at(-1).id).toBe('Y10_1');
    await h.snap(ava, 'Ava discarded the yellow 10');
    await h.snap(ben, "Ben's turn, yellow 10 on top");
  });

  test('discarding needs exactly one selected card', async ({ h }) => {
    const game = duel({ turnState: 'discard' });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await pick(ava, 'R1_1', 'B4_1');
    await expect(ava.getByTestId('button-discard')).toHaveCount(0);
    const res = await act(game.code, game.seats[0], 'discard', { cardIds: ['R1_1', 'B4_1'] });
    expect(res.json.error).toBe('Discard one card to end your turn.');
    await h.snap(ava, 'Two selected: no Discard button');
  });

  test('cannot discard before drawing', async ({ h }) => {
    const game = duel();
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await pick(ava, 'R1_1');
    await expect(ava.getByTestId('button-discard')).toHaveCount(0);
    const res = await act(game.code, game.seats[0], 'discard', { cardIds: ['R1_1'] });
    expect(res.json.error).toBe('Draw a card before discarding.');
    await h.snap(ava, 'Selected before drawing: no Discard');
  });

  test('drag a card onto the discard pile', async ({ h }) => {
    const game = duel({ turnState: 'discard' });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await dragTo(ava, hand(ava, 'G7_1'), ava.locator('[data-pile="discard"]'), { release: false });
    await expect(ava.getByTestId('button-draw-discard')).toHaveClass(/is-drop-target/);
    await h.snap(ava, 'Dragging over the discard pile');
    await ava.mouse.up();
    await expect.poll(() => stored(game.code).discardPile.at(-1).id).toBe('G7_1');
    await expect(turnStatus(ava)).toContainText('Ben is');
    await h.snap(ava, 'Dropped: discarded');
  });

  test('a discard keeps the rest of the selection', async ({ h }) => {
    const game = duel({ turnState: 'discard' });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await pick(ava, 'R1_1', 'B4_1');
    await dragTo(ava, hand(ava, 'G7_1'), ava.locator('[data-pile="discard"]'));
    await expect.poll(() => stored(game.code).discardPile.at(-1).id).toBe('G7_1');
    await expect(hand(ava, 'R1_1')).toHaveAttribute('aria-pressed', 'true');
    await expect(hand(ava, 'B4_1')).toHaveAttribute('aria-pressed', 'true');
    await h.snap(ava, 'Red 1 and blue 4 still selected');
  });
});

test.describe('Skips', () => {
  test('two players: a Skip gives the discarder another turn', async ({ h }) => {
    const game = duel({ turnState: 'discard' }, [...AVA, 'S']);
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    const ben = await h.open({ code: game.code, seat: game.seats[1] });
    await pick(ava, 'S_1');
    await ava.getByTestId('button-discard').click();
    await expect(ava.getByTestId('skip-announcement')).toContainText('Ava skipped Ben!');
    await expect(ben.getByTestId('skip-announcement')).toContainText('Ava skipped Ben!');
    await h.snap(ben, 'Ben sees the Skip announcement');
    await expect(ava.getByTestId('skip-announcement')).toHaveCount(0, { timeout: 4000 });
    await expect(turnStatus(ava)).toHaveText("it's your turn again because you skipped Ben");
    await expect(turnStatus(ben)).toContainText('Ava is drawing');
    await h.snap(ava, 'Announcement gone; Ava goes again');
  });

  test('three players: a Skip needs a target, then that player misses a turn', async ({ h }) => {
    const game = seed({ turnState: 'discard', players: [{ name: 'Ava', hand: [...AVA, 'S'] }, { name: 'Ben', hand: BEN }, { name: 'Cleo', hand: BEN.map(c => c.replace('G', 'R')) }] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    const cleo = await h.open({ code: game.code, seat: game.seats[2] });
    await pick(ava, 'S_1');
    await expect(ava.getByTestId('button-discard')).toBeDisabled();
    await h.snap(ava, 'Skip selected: choose a target first');
    await ava.getByTestId('select-skip-target').selectOption({ label: 'Cleo' });
    await ava.getByTestId('button-discard').click();
    await expect(cleo.getByTestId('skip-announcement')).toContainText('Ava skipped Cleo!');
    await h.snap(cleo, 'Cleo is skipped');
    expect(stored(game.code).currentPlayerId).toBe(game.seats[1].id);
    await act(game.code, game.seats[1], 'draw-deck');
    await act(game.code, game.seats[1], 'discard', { cardIds: ['Y4_1'] });
    expect(stored(game.code).currentPlayerId).toBe(game.seats[0].id);
    await expect(turnStatus(ava)).toHaveText('Your turn. Draw a card.');
    await expect(turnStatus(cleo)).toContainText('Ava is drawing');
    await h.snap(cleo, 'Turn passed over Cleo back to Ava');
  });

  test('you cannot skip yourself (server)', async ({ h }) => {
    const game = seed({ turnState: 'discard', players: [{ name: 'Ava', hand: ['S', 'R1'] }, { name: 'Ben', hand: BEN }, { name: 'Cleo', hand: BEN }] });
    const self = await act(game.code, game.seats[0], 'discard', { cardIds: ['S_1'], targetPlayerId: game.seats[0].id });
    const none = await act(game.code, game.seats[0], 'discard', { cardIds: ['S_1'] });
    expect(self.json.error).toBe('Choose another player to skip.');
    expect(none.json.error).toBe('Choose another player to skip.');
    await h.note('Responses', { self: self.json, none: none.json });
  });

  test('the Skip announcement is not replayed after a reload', async ({ h }) => {
    const game = duel({ turnState: 'discard' }, [...AVA, 'S']);
    const ben = await h.open({ code: game.code, seat: game.seats[1] });
    await act(game.code, game.seats[0], 'discard', { cardIds: ['S_1'] });
    await expect(ben.getByTestId('skip-announcement')).toBeVisible();
    await ben.reload();
    await expect(ben.getByTestId('game-table')).toBeVisible();
    await ben.waitForTimeout(1500);
    await expect(ben.getByTestId('skip-announcement')).toHaveCount(0);
    await h.snap(ben, 'After reload: no announcement');
  });
});

test.describe('Hand handling', () => {
  test('Sort my hand: by number, then color; Wild and Skip last', async ({ h }) => {
    const game = duel({}, ['S', 'R9', 'W', 'B2', 'G9', 'Y2', 'R1', 'B12', 'G5', 'Y5']);
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await h.snap(ava, 'Dealt order');
    await ava.getByTestId('button-sort-hand').click();
    await expect.poll(() => handOrder(ava)).toEqual(['R1_1', 'B2_1', 'Y2_1', 'G5_1', 'Y5_1', 'G9_1', 'R9_1', 'B12_1', 'W_1', 'S_1']);
    await h.snap(ava, 'Sorted by number');
    await ava.getByTestId('button-sort-hand-color').click();
    await expect.poll(() => handOrder(ava)).toEqual(['R1_1', 'R9_1', 'B2_1', 'B12_1', 'G5_1', 'G9_1', 'Y2_1', 'Y5_1', 'W_1', 'S_1']);
    await h.snap(ava, 'Sorted by color');
  });

  test('drag to reorder the hand, and the order survives a reload', async ({ h }) => {
    const game = duel();
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    expect((await handOrder(ava))[0]).toBe('R1_1');
    await dragTo(ava, hand(ava, 'R1_1'), hand(ava, 'Y5_1'));
    await expect.poll(async () => (await handOrder(ava)).indexOf('R1_1')).toBeGreaterThan(4);
    const order = await handOrder(ava);
    await h.snap(ava, 'Red 1 dragged to the middle');
    await ava.reload();
    await expect(ava.getByTestId('game-table')).toBeVisible();
    await expect.poll(() => handOrder(ava)).toEqual(order);
    expect(stored(game.code).players[0].hand).toHaveLength(10);
    await h.snap(ava, 'Same order after reload');
  });

  test('Escape cancels a drag', async ({ h }) => {
    const game = duel({ turnState: 'discard' });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    const before = await handOrder(ava);
    await dragTo(ava, hand(ava, 'R1_1'), ava.locator('[data-pile="discard"]'), { release: false });
    await expect(ava.getByTestId('hand-drop-placeholder')).toBeVisible();
    await h.snap(ava, 'Mid-drag');
    await ava.keyboard.press('Escape');
    await expect(ava.getByTestId('hand-drop-placeholder')).toHaveCount(0);
    await ava.mouse.up();
    await ava.waitForTimeout(300);
    expect(await handOrder(ava)).toEqual(before);
    expect(stored(game.code).discardPile.at(-1).id).toBe('G6_1');
    await h.snap(ava, 'Cancelled: nothing moved or discarded');
  });

  test('click cards to select; click blank space to clear', async ({ h }) => {
    const game = duel();
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    const card = hand(ava, 'G7_1');
    const point = await grabPoint(card);
    await ava.mouse.click(point.x, point.y);
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await pick(ava, 'Y10_1');
    await h.snap(ava, 'Two cards selected (lifted)');
    await ava.mouse.click(550, 330);
    await expect(ava.locator('[data-testid^="card-in-hand-"][aria-pressed="true"]')).toHaveCount(0);
    await h.snap(ava, 'Cleared by clicking the table');
  });
});

test.describe('Table', () => {
  test('Scores and Rules panels', async ({ h }) => {
    const game = duel({ roundNumber: 3 });
    rig(game.code, room => { room.players[0].score = 40; room.players[1].score = 15; room.players[1].phase = 3; });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await ava.getByTestId('button-open-scores').click();
    const panel = ava.getByRole('dialog', { name: 'Scoreboard' });
    await expect(panel).toContainText('Round 3');
    await expect(panel.getByTestId(`text-score-${game.seats[0].id}`)).toHaveText('40');
    await h.snap(ava, 'Scores');
    await ava.getByTestId('tab-rules').click();
    await expect(ava.getByRole('dialog', { name: 'Rules' })).toContainText('Two Groups of 3');
    await expect(ava.getByRole('dialog', { name: 'Rules' })).not.toContainText(/Phase|Meld/);
    await h.snap(ava, 'Rules');
    await ava.getByTestId('button-close-drawer').click();
    await expect(ava.getByRole('dialog', { name: 'Rules' })).toHaveCount(0);
  });

  test('your level and its objective are shown', async ({ h }) => {
    const game = seed({ players: [{ name: 'Ava', hand: AVA, phase: 2 }, { name: 'Ben', hand: BEN, phase: 8 }] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await expect(ava.getByTestId(`text-player-level-${game.seats[0].id}`)).toContainText('Level 2:Group of 3 + Sequence of 4, Any Color');
    await expect(ava.getByTestId(`text-player-level-${game.seats[1].id}`)).toContainText('Level 8');
    await h.snap(ava, 'Level 2 objective');
  });

  test('a bot takes its turn on its own', async ({ h }) => {
    const game = seed({ current: 1, players: [{ name: 'Ava', hand: AVA }, { name: 'Botley', hand: BEN, isBot: true }] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await expect(turnStatus(ava)).toContainText('Botley is');
    await h.snap(ava, 'Botley to play');
    await expect(turnStatus(ava)).toHaveText('Your turn. Draw a card.', { timeout: 10_000 });
    const room = stored(game.code);
    expect(room.players[1].hand).toHaveLength(10);
    expect(room.discardPile).toHaveLength(2);
    await h.snap(ava, 'Botley drew and discarded');
  });

  test('a rejected move shows the server error', async ({ h }) => {
    const game = duel();
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    // Hold polls so the page still believes it is Ava's turn, then move the turn behind its back.
    await ava.route('**/api/rush10/rooms/*', route => route.request().method() === 'GET' ? new Promise(() => {}) : route.continue());
    await ava.waitForTimeout(1000);
    rig(game.code, room => { room.currentPlayerId = room.players[1].id; });
    await ava.getByTestId('button-draw-deck').click();
    await expect(ava.getByTestId('game-notification')).toContainText('Wait for your turn.');
    await h.snap(ava, 'Server said: Wait for your turn.');
    await ava.getByTestId('dismiss-game-notification').click();
    await expect(ava.getByTestId('game-notification')).toHaveCount(0);
  });

  test('reloading mid-turn restores the table', async ({ h }) => {
    const game = duel({ turnState: 'discard' });
    const ava = await h.open({ code: game.code, seat: game.seats[0] });
    await ava.reload();
    await expect(ava.getByTestId('game-table')).toBeVisible();
    await expect(turnStatus(ava)).toHaveText('Finish your turn: lay cards down, add to a pile, or discard');
    await expect(ava.locator('[data-testid^="card-in-hand-"]')).toHaveCount(10);
    await h.snap(ava, 'Reloaded');
  });

  test('phone layout keeps the piles and hand on screen', async ({ h }) => {
    const game = seed({ players: [{ name: 'Ava', hand: [...AVA, 'W'] }, { name: 'Ben', hand: BEN }, { name: 'Cleo', hand: BEN }, { name: 'Dev', hand: BEN }] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] }, { viewport: { width: 390, height: 844 } });
    for (const id of ['button-draw-deck', 'button-draw-discard']) await expect(ava.getByTestId(id)).toBeInViewport();
    for (const id of ['R1_1', 'W_1']) await expect(hand(ava, id)).toBeInViewport({ ratio: 0.5 });
    await h.snap(ava, 'Phone, four players');
  });

  test('short wide window keeps everything reachable', async ({ h }) => {
    const game = seed({ players: [{ name: 'Ava', hand: AVA }, { name: 'Ben', hand: BEN }, { name: 'Cleo', hand: BEN }, { name: 'Dev', hand: BEN }, { name: 'Eli', hand: BEN }, { name: 'Fay', hand: BEN }] });
    const ava = await h.open({ code: game.code, seat: game.seats[0] }, { viewport: { width: 1400, height: 620 } });
    for (const id of ['button-draw-deck', 'button-exit', 'button-sort-hand']) await expect(ava.getByTestId(id)).toBeInViewport();
    await expect(hand(ava, 'R1_1')).toBeInViewport({ ratio: 0.5 });
    await h.snap(ava, '1400×620, six players');
  });
});

test.describe('Server authority', () => {
  test('two simultaneous draws: only one lands', async ({ h }) => {
    const game = duel();
    const [a, b] = await Promise.all([act(game.code, game.seats[0], 'draw-deck'), act(game.code, game.seats[0], 'draw-deck')]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(stored(game.code).players[0].hand).toHaveLength(11);
    await h.note('Responses', { a: a.ok ? 'ok' : a.json, b: b.ok ? 'ok' : b.json });
  });

  test('an unknown seat token is refused', async ({ h }) => {
    const game = duel();
    const res = await api(`/rooms/${game.code}`, { method: 'GET', token: 'not-a-token' });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('That player session is not valid for this game.');
    await h.note('Response', res.json);
  });

  test('the view never reveals other hands or the draw pile', async ({ h }) => {
    const game = duel();
    const res = await api(`/rooms/${game.code}`, { method: 'GET', token: game.seats[0].token });
    const text = JSON.stringify(res.json);
    expect(text).not.toContain('G1_1');
    expect(text).not.toContain(game.seats[1].token);
    expect(res.json.players[1].handCount).toBe(10);
    expect(res.json.drawPile).toBeUndefined();
    await h.note('Player view keys', Object.keys(res.json).join(', '));
  });
});
