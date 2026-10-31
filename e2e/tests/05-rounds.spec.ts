import { act, api, expect, hand, pick, rig, seed, stored, test, turnStatus, type MeldSpec } from '../lib/harness';
import type { Page } from '@playwright/test';

const results = (page: Page) => page.getByTestId('dialog-round-over');
const scoreOrder = (page: Page) => results(page).locator('[data-testid^="result-row-"] .font-mono').allTextContents();

const AVA_7S: MeldSpec = { id: 'ava-7s', owner: 0, type: 'group', cards: ['R7', 'B7', 'G7'] };
const AVA_9S: MeldSpec = { id: 'ava-9s', owner: 0, type: 'group', cards: ['R9', 'B9', 'G9'] };

test.describe('Ending a round', () => {
  test('discarding your last card ends the round and scores it', async ({ h }) => {
    // Ben holds Wild 25 + Skip 15 + 12 (10) + 3 (5) = 55.
    const g = seed({ turnState: 'discard', players: [
      { name: 'Ava', hand: ['G4'], hasLaidPhase: true, score: 20 },
      { name: 'Ben', hand: ['W', 'S', 'R12', 'B3'], score: 10 },
    ], melds: [AVA_7S, AVA_9S] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await pick(ava, 'G4_1');
    await ava.getByTestId('button-discard').click();
    await expect(results(ava)).toContainText('Round 1 Complete');
    await expect(results(ava).getByTestId('text-round-end-reason')).toHaveText('Ava played all their cards.');
    await expect(results(ben)).toContainText('Ava played all their cards.');
    const room = stored(g.code);
    expect(room.status).toBe('round-over');
    expect(room.players.map((p: { score: number; phase: number }) => [p.score, p.phase])).toEqual([[20, 2], [65, 1]]);
    expect(await scoreOrder(ava)).toEqual(['20', '65']);
    await expect(results(ava).getByTestId(`result-row-${g.seats[0].id}`)).toContainText('Level 2');
    await h.snap(ava, 'Results: lowest score first, in yellow');
    await h.snap(ben, "Ben's results: waiting for the host");
    await expect(ben.getByText('Waiting for the host to deal the next round')).toBeVisible();
    await expect(ben.getByTestId('button-next-round')).toHaveCount(0);
    await expect(ava.getByTestId('button-sort-hand')).toHaveCount(0);
  });

  test('adding your last card to a pile ends the round at once', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [
      { name: 'Ava', hand: ['Y7'], hasLaidPhase: true }, { name: 'Ben', hand: ['R1', 'R2'] },
    ], melds: [AVA_7S, AVA_9S] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'Y7_1');
    await ava.getByTestId('button-hit-ava-7s').click();
    await expect(results(ava).getByTestId('text-round-end-reason')).toHaveText('Ava played all their cards.');
    expect(stored(g.code).discardPile.at(-1).id).not.toBe('Y7_1');
    await h.snap(ava, 'Round over without a discard');
  });

  test('laying down your whole hand ends the round', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [
      { name: 'Ava', hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9'] }, { name: 'Ben', hand: ['R1'] },
    ] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R5_1', 'B5_1', 'G5_1', 'R9_1', 'Y9_1', 'B9_1');
    await ava.getByTestId('button-lay-phase').click();
    await expect(results(ava).getByTestId('text-round-end-reason')).toHaveText('Ava played all their cards.');
    await h.snap(ava, 'Laid every card');
  });

  test('the round ends when every player has completed their level', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [
      { name: 'Ava', hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9', 'Y1'] },
      { name: 'Ben', hand: ['R1', 'R2'], hasLaidPhase: true },
    ], melds: [{ owner: 1, type: 'group', cards: ['R7', 'B7', 'G7'] }, { owner: 1, type: 'group', cards: ['R3', 'B3', 'G3'] }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await pick(ava, 'R5_1', 'B5_1', 'G5_1', 'R9_1', 'Y9_1', 'B9_1');
    await ava.getByTestId('button-lay-phase').click();
    await expect(results(ava).getByTestId('text-round-end-reason')).toHaveText('All players completed their level.');
    await expect(results(ben).getByTestId('text-round-end-reason')).toHaveText('All players completed their level.');
    expect(stored(g.code).players.map((p: { phase: number; score: number }) => [p.phase, p.score])).toEqual([[2, 5], [2, 10]]);
    await h.snap(ben, 'Both completed; both advance');
  });

  test('a player who did not lay their level stays on it', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [
      { name: 'Ava', hand: ['G4'], hasLaidPhase: true, phase: 3 }, { name: 'Ben', hand: ['R1'], phase: 3 }, { name: 'Cleo', hand: ['R2'], phase: 5 },
    ], melds: [{ owner: 0, type: 'group', cards: ['R7', 'B7', 'G7', 'Y7'] }, { owner: 0, type: 'sequence', cards: ['R1', 'B2', 'G3', 'Y4'] }] });
    await act(g.code, g.seats[0], 'discard', { cardIds: ['G4_1'] });
    expect(stored(g.code).players.map((p: { phase: number }) => p.phase)).toEqual([4, 3, 5]);
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await expect(results(ben).getByTestId(`result-row-${g.seats[1].id}`)).toContainText('Level 3');
    await h.snap(ben, 'Ava to Level 4; Ben and Cleo stay');
  });

  test('scoring: 1–9 are 5, 10–12 are 10, Skip 15, Wild 25', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [
      { name: 'Ava', hand: ['G4'], hasLaidPhase: true },
      { name: 'Ben', hand: ['R1', 'B9'] }, { name: 'Cleo', hand: ['R10', 'G11', 'Y12'] },
      { name: 'Dev', hand: ['S'] }, { name: 'Eli', hand: ['W'] }, { name: 'Fay', hand: ['W', 'S', 'R10', 'R5'] },
    ], melds: [AVA_7S, AVA_9S] });
    await act(g.code, g.seats[0], 'discard', { cardIds: ['G4_1'] });
    expect(stored(g.code).players.map((p: { score: number }) => p.score)).toEqual([0, 10, 30, 15, 25, 55]);
    const fay = await h.open({ code: g.code, seat: g.seats[5] });
    expect(await scoreOrder(fay)).toEqual(['0', '10', '15', '25', '30', '55']);
    await h.snap(fay, 'Six scores, low to high');
  });

  test('a finished round is only scored once, however many polls arrive', async ({ h }) => {
    // A saved game left playing with an empty hand (the old bug) is recovered by the next poll.
    const g = seed({ turnState: 'discard', players: [{ name: 'Ava', hand: [], hasLaidPhase: true }, { name: 'Ben', hand: ['W'] }], melds: [AVA_7S, AVA_9S] });
    await Promise.all(Array.from({ length: 6 }, () => api(`/rooms/${g.code}`, { method: 'GET', token: g.seats[1].token })));
    const room = stored(g.code);
    expect(room.status).toBe('round-over');
    expect(room.players.map((p: { score: number; phase: number }) => [p.score, p.phase])).toEqual([[0, 2], [25, 1]]);
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await expect(results(ben)).toContainText('Round 1 Complete');
    await h.snap(ben, 'Recovered and scored once');
  });

  test('no moves while the round is over', async ({ h }) => {
    const g = seed({ status: 'round-over', players: [{ name: 'Ava', hand: [] }, { name: 'Ben', hand: ['R1'] }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await expect(ava.locator('.game-layout')).toHaveAttribute('inert', '');
    const res = await act(g.code, g.seats[1], 'draw-deck');
    expect(res.json.error).toBe('The game is not in progress.');
    await h.snap(ava, 'Table blurred and inert behind the results');
  });

  test('the host deals the next round; the dealer rotates', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [
      { name: 'Ava', hand: ['G4'], hasLaidPhase: true }, { name: 'Ben', hand: ['R1', 'R2'] },
    ], melds: [AVA_7S, AVA_9S] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await act(g.code, g.seats[0], 'discard', { cardIds: ['G4_1'] });
    await ava.getByTestId('button-next-round').click();
    await expect(results(ava)).toHaveCount(0);
    await expect(ava.locator('[data-testid^="card-in-hand-"]')).toHaveCount(10);
    await expect(results(ben)).toHaveCount(0);
    await expect(ben.locator('[data-testid^="card-in-hand-"]')).toHaveCount(10);
    await expect(turnStatus(ben)).toHaveText('Your turn. Draw a card.');
    await expect(ava.getByTestId(`text-player-level-${g.seats[0].id}`)).toContainText('Level 2');
    const room = stored(g.code);
    expect(room.roundNumber).toBe(2);
    expect(room.melds).toEqual([]);
    expect(room.players.every((p: { hasLaidPhase: boolean }) => !p.hasLaidPhase)).toBe(true);
    await h.snap(ava, 'Round 2: Ava on Level 2');
    await h.snap(ben, 'Round 2: Ben plays first');
  });

  test('only the host can deal the next round (server)', async ({ h }) => {
    const g = seed({ status: 'round-over', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const res = await api(`/rooms/${g.code}/start`, { body: { playerToken: g.seats[1].token } });
    expect(res.status).toBe(403);
    await h.note('Response', res.json);
  });
});

test.describe('Winning and leaving', () => {
  test('completing Level 10 wins the game', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [
      { name: 'Ava', hand: ['G4'], hasLaidPhase: true, phase: 10, score: 120 }, { name: 'Ben', hand: ['R1', 'W'], phase: 9, score: 60 },
    ], melds: [{ owner: 0, type: 'group', cards: ['R7', 'B7', 'G7', 'Y7', 'W'] }, { owner: 0, type: 'group', cards: ['R2', 'B2', 'G2'] }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await act(g.code, g.seats[0], 'discard', { cardIds: ['G4_1'] });
    await expect(ava.getByTestId('text-game-over')).toHaveText('Game Over');
    await expect(ava.getByTestId('text-game-end-reason')).toHaveText('You completed Level 10 and won the game!');
    await expect(ben.getByTestId('text-game-end-reason')).toHaveText('Ava completed Level 10 and won the game!');
    await expect(ben.getByTestId(`result-row-${g.seats[0].id}`).getByLabel('Winner')).toBeVisible();
    await expect(ava.getByTestId('button-next-round')).toHaveCount(0);
    const room = stored(g.code);
    expect([room.status, room.winnerId, room.endReason]).toEqual(['finished', g.seats[0].id, 'level-10']);
    await h.snap(ava, 'Ava wins');
    await h.snap(ben, 'Ben sees Ava win');
  });

  test('two players finish Level 10: the lowest score wins', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [
      { name: 'Ava', hand: ['G4'], hasLaidPhase: true, phase: 10, score: 150 },
      { name: 'Ben', hand: ['R1'], hasLaidPhase: true, phase: 10, score: 40 },
      { name: 'Cleo', hand: ['R2'], phase: 10, score: 0 },
    ], melds: [
      { owner: 0, type: 'group', cards: ['R7', 'B7', 'G7', 'Y7', 'W'] }, { owner: 0, type: 'group', cards: ['R2', 'B2', 'G2'] },
      { owner: 1, type: 'group', cards: ['R8', 'B8', 'G8', 'Y8', 'W'] }, { owner: 1, type: 'group', cards: ['R3', 'B3', 'G3'] },
    ] });
    await act(g.code, g.seats[0], 'discard', { cardIds: ['G4_1'] });
    const room = stored(g.code);
    expect(room.winnerId).toBe(g.seats[1].id);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await expect(ava.getByTestId('text-game-end-reason')).toHaveText('Ben completed Level 10 and won the game!');
    await h.snap(ava, 'Ben wins on the lower score; Cleo never laid Level 10');
  });

  test('Exit Game asks first, and Stay keeps you playing', async ({ h }) => {
    const g = seed({ players: [{ name: 'Ava', hand: ['R1'] }, { name: 'Ben', hand: ['R2'] }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await ava.getByTestId('button-exit').click();
    await expect(ava.getByTestId('dialog-exit-confirm')).toContainText('This will end the game for all players.');
    await h.snap(ava, 'Exit confirmation');
    await ava.getByTestId('button-stay-in-game').click();
    await expect(ava.getByTestId('dialog-exit-confirm')).toHaveCount(0);
    expect(stored(g.code).status).toBe('playing');
  });

  test('leaving ends the game for everyone', async ({ h }) => {
    const g = seed({ players: [{ name: 'Ava', hand: ['R1'] }, { name: 'Ben', hand: ['R2'] }, { name: 'Cleo', hand: ['R3'] }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await ava.getByTestId('button-exit').click();
    await ava.getByTestId('button-confirm-exit').click();
    await expect(ava.getByTestId('button-create-room')).toBeVisible();
    await expect(ben.getByTestId('text-game-end-reason')).toHaveText('Ava left the game, so the game is over.');
    await expect(ben.getByTestId(`result-row-${g.seats[0].id}`)).toContainText('(left)');
    const room = stored(g.code);
    expect([room.status, room.endReason, room.endedByPlayerId, room.winnerId]).toEqual(['finished', 'player-left', g.seats[0].id, null]);
    await h.snap(ben, 'Ben: Ava left, game over');
    await h.snap(ava, 'Ava is home, with no reconnect offer');
  });

  test('exiting a finished game goes straight home', async ({ h }) => {
    const g = seed({ status: 'finished', players: [{ name: 'Ava', hand: [] }, { name: 'Ben', hand: ['R2'] }] });
    rig(g.code, room => { room.endReason = 'player-left'; room.endedByPlayerId = room.players[1].id; });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await ava.getByTestId('button-exit-overlay').click();
    await expect(ava.getByTestId('dialog-exit-confirm')).toHaveCount(0);
    await expect(ava.getByTestId('button-create-room')).toBeVisible();
    await h.snap(ava, 'Home');
  });

  test('a finished game cannot be restarted (server)', async ({ h }) => {
    const g = seed({ status: 'finished', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const res = await api(`/rooms/${g.code}/start`, { body: { playerToken: g.seats[0].token } });
    expect(res.json.error).toBe('This game has finished. Start a new game.');
    await h.note('Response', res.json);
  });

  test('reloading on the results keeps them', async ({ h }) => {
    const g = seed({ turnState: 'discard', players: [{ name: 'Ava', hand: ['G4'], hasLaidPhase: true }, { name: 'Ben', hand: ['R1'] }], melds: [AVA_7S, AVA_9S] });
    await act(g.code, g.seats[0], 'discard', { cardIds: ['G4_1'] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await ben.reload();
    await expect(results(ben)).toContainText('Round 1 Complete');
    await expect(hand(ben, 'R1_1')).toBeAttached();
    await h.snap(ben, 'Results after reload');
  });
});
