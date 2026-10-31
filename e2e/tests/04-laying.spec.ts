import { act, dragTo, expect, hand, pick, seed, stored, test, turnStatus, type MeldSpec, type SeatSpec } from '../lib/harness';
import type { Page } from '@playwright/test';

const OTHER = ['G1', 'Y4', 'R8', 'B10', 'G12', 'Y2', 'R9', 'B5', 'G3', 'Y11'];
const meldStatus = (page: Page) => page.getByTestId('text-meld-status');
const pile = (page: Page, id: string) => page.getByTestId(`button-hit-${id}`);
const laid = (page: Page, zone: string) => page.locator(`[data-meld-zone="${zone}"] [data-drop-meld]`);

/** Ava to play (already drawn unless `turnState` says otherwise) against Ben, and Cleo when Ben has laid
 *  (if everyone has laid their level, the round is over). */
function game(ava: Omit<SeatSpec, 'name'>, options: { ben?: Partial<SeatSpec>; melds?: MeldSpec[]; turnState?: 'draw' | 'discard' } = {}) {
  const cleo = options.ben?.hasLaidPhase ? [{ name: 'Cleo', hand: ['G4', 'G8'] }] : [];
  return seed({
    turnState: options.turnState ?? 'discard',
    players: [{ name: 'Ava', ...ava }, { name: 'Ben', hand: OTHER, ...options.ben }, ...cleo],
    melds: options.melds,
  });
}

/** Ava has laid Level 1 (Group of 7s, Group of 11s); Ben has laid Level 2 (Group of 10s, Sequence 3–6). */
const TABLE: MeldSpec[] = [
  { id: 'ava-7s', owner: 0, type: 'group', cards: ['R7', 'B7', 'G7'] },
  { id: 'ava-11s', owner: 0, type: 'group', cards: ['R11', 'B11', 'G11'] },
  { id: 'ben-10s', owner: 1, type: 'group', cards: ['R10', 'Y10', 'G10'] },
  { id: 'ben-run', owner: 1, type: 'sequence', cards: ['Y3', 'B4', 'G5', 'R6'] },
];
const laidTable = (avaHand: string[], extra: { benLaid?: boolean } = {}) =>
  game({ hand: avaHand, hasLaidPhase: true }, { ben: { phase: 2, hasLaidPhase: extra.benLaid ?? true }, melds: TABLE });

test.describe('Recognizing a level', () => {
  test('selection progress: partial, ready, then extra', async ({ h }) => {
    const g = game({ hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9', 'G2', 'Y3', 'R12', 'B12', 'Y6'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await expect(meldStatus(ava)).toHaveText('Click cards to make a group to lay');
    await pick(ava, 'R5_1', 'B5_1');
    await expect(meldStatus(ava)).toHaveAttribute('data-status', 'partial');
    await h.snap(ava, 'Two 5s: partial');
    await pick(ava, 'G5_1', 'R9_1', 'Y9_1', 'B9_1');
    await expect(meldStatus(ava)).toHaveAttribute('data-status', 'ready');
    await expect(ava.getByTestId('button-lay-phase')).toBeEnabled();
    await h.snap(ava, 'Two Groups of 3: ready');
    await pick(ava, 'G2_1');
    await expect(meldStatus(ava)).toHaveAttribute('data-status', 'extra');
    await expect(ava.getByTestId('button-lay-phase')).toHaveCount(0);
    await h.snap(ava, 'Plus one extra card');
  });

  test('cards that make nothing say so', async ({ h }) => {
    const g = game({ hand: ['R1', 'B4', 'G7', 'Y10', 'R12', 'B2', 'G9', 'Y5', 'R3', 'B11', 'S'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R1_1', 'B4_1', 'S_1');
    await expect(meldStatus(ava)).toHaveAttribute('data-status', /none|partial/);
    await expect(ava.getByTestId('button-lay-phase')).toHaveCount(0);
    await h.snap(ava, 'Unrelated cards');
  });

  test('Lay Down is blocked until you draw', async ({ h }) => {
    const g = game({ hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9', 'G2', 'Y3', 'R12', 'B12'] }, { turnState: 'draw' });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R5_1', 'B5_1', 'G5_1', 'R9_1', 'Y9_1', 'B9_1');
    await expect(ava.getByTestId('button-lay-phase')).toBeDisabled();
    await expect(ava.getByTestId('text-lay-blocker')).toHaveText('Draw a card first');
    await h.snap(ava, 'Ready, but draw first');
  });

  test("Lay Down is blocked on someone else's turn", async ({ h }) => {
    const g = game({ hand: ['G1', 'Y4', 'R8', 'B10', 'G12', 'Y2', 'R3', 'B6', 'G3', 'Y11'] }, { ben: { hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9', 'G2', 'Y3', 'R12', 'B12'] } });
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await pick(ben, 'R5_1', 'B5_1', 'G5_1', 'R9_1', 'Y9_1', 'B9_1');
    await expect(ben.getByTestId('button-lay-phase')).toBeDisabled();
    await expect(ben.getByTestId('text-lay-blocker')).toHaveText('Wait for your turn');
    await h.snap(ben, 'Ready, but not your turn');
  });
});

test.describe('Laying down a level', () => {
  test('Level 1: two Groups of 3', async ({ h }) => {
    const g = game({ hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9', 'G2', 'Y3', 'R12', 'B12', 'Y6'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await pick(ava, 'R5_1', 'B5_1', 'G5_1', 'R9_1', 'Y9_1', 'B9_1');
    await ava.getByTestId('button-lay-phase').click();
    await expect(laid(ava, g.seats[0].id)).toHaveCount(2);
    await expect(laid(ava, g.seats[0].id).first()).toHaveAttribute('aria-label', /Group of (5|9)s/);
    await expect(ava.locator('[data-testid^="card-in-hand-"]')).toHaveCount(5);
    await expect(ava.getByTestId(`text-player-level-${g.seats[0].id}`).getByLabel('Level laid')).toBeVisible();
    await expect(meldStatus(ava)).toHaveCount(0);
    await h.snap(ava, 'Ava laid two Groups');
    await expect(laid(ben, g.seats[0].id)).toHaveCount(2);
    await h.snap(ben, "Ben sees Ava's Groups");
    const room = stored(g.code);
    expect(room.players[0].hasLaidPhase).toBe(true);
    expect(room.status).toBe('playing');
    expect(room.turnState).toBe('discard');
  });

  test('Wild cards fill a Group', async ({ h }) => {
    const g = game({ hand: ['R5', 'W', 'G5', 'R9', 'W', 'B9', 'G2', 'Y3', 'R12', 'B12', 'Y6'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R5_1', 'W_1', 'G5_1', 'R9_1', 'W_2', 'B9_1');
    await expect(meldStatus(ava)).toHaveAttribute('data-status', 'ready');
    await ava.getByTestId('button-lay-phase').click();
    await expect(laid(ava, g.seats[0].id)).toHaveCount(2);
    await h.snap(ava, 'Groups with Wilds');
  });

  test('Level 2: Group of 3 and a Sequence of 4 with a Wild in the gap', async ({ h }) => {
    const g = game({ phase: 2, hand: ['R7', 'B7', 'G7', 'Y3', 'W', 'R5', 'B6', 'G1', 'Y12', 'R2', 'B10'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R7_1', 'B7_1', 'G7_1', 'Y3_1', 'W_1', 'R5_1', 'B6_1');
    await expect(meldStatus(ava)).toHaveAttribute('data-status', 'ready');
    await h.snap(ava, 'Ready: Group + Sequence');
    await ava.getByTestId('button-lay-phase').click();
    await expect(laid(ava, g.seats[0].id)).toHaveCount(2);
    await expect(ava.locator(`[data-meld-zone="${g.seats[0].id}"]`)).toContainText('Sequence 3–6');
    await h.snap(ava, 'Sequence 3–6 shown in order with the Wild as 4');
  });

  test('Level 4: Sequence of 7', async ({ h }) => {
    const g = game({ phase: 4, hand: ['R6', 'B7', 'G8', 'Y9', 'R10', 'B11', 'G12', 'Y3', 'R1', 'B2', 'G2'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R6_1', 'B7_1', 'G8_1', 'Y9_1', 'R10_1', 'B11_1', 'G12_1');
    await ava.getByTestId('button-lay-phase').click();
    await expect(ava.locator(`[data-meld-zone="${g.seats[0].id}"]`)).toContainText('Sequence 6–12');
    await h.snap(ava, 'Sequence 6–12');
  });

  test('Level 8: seven cards of one color', async ({ h }) => {
    const g = game({ phase: 8, hand: ['B1', 'B3', 'B3', 'B8', 'B9', 'W', 'B12', 'R4', 'Y5', 'G6', 'G7'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'B1_1', 'B3_1', 'B3_2', 'B8_1', 'B9_1', 'W_1', 'B12_1');
    await ava.getByTestId('button-lay-phase').click();
    await expect(ava.locator(`[data-meld-zone="${g.seats[0].id}"]`)).toContainText(/Color · blue/i);
    await h.snap(ava, 'Seven blue cards');
  });

  test('Level 9: Group of 5 and Group of 2', async ({ h }) => {
    const g = game({ phase: 9, hand: ['R4', 'B4', 'G4', 'Y4', 'W', 'R12', 'B12', 'G1', 'Y2', 'R3', 'B6'] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R4_1', 'B4_1', 'G4_1', 'Y4_1', 'W_1', 'R12_1', 'B12_1');
    await ava.getByTestId('button-lay-phase').click();
    await expect(laid(ava, g.seats[0].id)).toHaveCount(2);
    await h.snap(ava, 'Group of 5 + Group of 2');
  });

  test('the server rejects a selection that is not your level', async ({ h }) => {
    const g = game({ phase: 2, hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9', 'G2'] });
    const res = await act(g.code, g.seats[0], 'lay-phase', { melds: [{ type: 'group', cardIds: ['R5_1', 'B5_1', 'G5_1'] }, { type: 'group', cardIds: ['R9_1', 'Y9_1', 'B9_1'] }] });
    expect(res.json.error).toBe('Level 2 requires One Group of 3 and one Sequence of 4.');
    expect(stored(g.code).players[0].hand).toHaveLength(7);
    await h.note('Response', res.json);
  });

  test('the server rejects a Skip in a Group and a broken Sequence', async ({ h }) => {
    const g = game({ phase: 2, hand: ['R5', 'B5', 'S', 'R1', 'Y2', 'B3', 'G9'] });
    const skip = await act(g.code, g.seats[0], 'lay-phase', { melds: [{ type: 'group', cardIds: ['R5_1', 'B5_1', 'S_1'] }, { type: 'sequence', cardIds: ['R1_1', 'Y2_1', 'B3_1', 'G9_1'] }] });
    expect(skip.json.error).toBe('A Group needs number cards or Wild cards.');
    const g2 = game({ phase: 2, hand: ['R5', 'B5', 'G5', 'R1', 'Y2', 'B3', 'G9'] });
    const gap = await act(g2.code, g2.seats[0], 'lay-phase', { melds: [{ type: 'group', cardIds: ['R5_1', 'B5_1', 'G5_1'] }, { type: 'sequence', cardIds: ['R1_1', 'Y2_1', 'B3_1', 'G9_1'] }] });
    expect(gap.json.error).toMatch(/consecutive Sequence/);
    await h.note('Responses', { skip: skip.json, gap: gap.json });
  });

  test('a level can only be laid once per round (server)', async ({ h }) => {
    const g = game({ hasLaidPhase: true, hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9', 'G2'] });
    const res = await act(g.code, g.seats[0], 'lay-phase', { melds: [{ type: 'group', cardIds: ['R5_1', 'B5_1', 'G5_1'] }, { type: 'group', cardIds: ['R9_1', 'Y9_1', 'B9_1'] }] });
    expect(res.json.error).toBe('You have already laid your level this round.');
    await h.note('Response', res.json);
  });
});

test.describe('Adding cards to laid-down piles', () => {
  test('cannot add to piles before laying your own level', async ({ h }) => {
    const g = game({ hand: ['R10', 'B2', 'G3'] }, { ben: { phase: 2, hasLaidPhase: true }, melds: TABLE.filter(m => m.owner === 1) });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R10_1');
    await expect(pile(ava, 'ben-10s')).toBeDisabled();
    await expect(pile(ava, 'ben-10s')).not.toHaveClass(/can-hit/);
    const res = await act(g.code, g.seats[0], 'hit', { cardIds: ['R10_1'], meldId: 'ben-10s' });
    expect(res.json.error).toBe('Lay down your own level before adding cards to a pile.');
    await h.snap(ava, 'Red 10 selected; no pile lights up');
  });

  test('only legal piles light up', async ({ h }) => {
    const g = laidTable(['B7', 'Y12', 'Y8', 'B2']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'B7_1');
    await expect(pile(ava, 'ava-7s')).toHaveClass(/can-hit/);
    await expect(pile(ava, 'ben-run')).toHaveClass(/can-hit/);
    await expect(pile(ava, 'ava-11s')).not.toHaveClass(/can-hit/);
    await expect(pile(ava, 'ben-10s')).not.toHaveClass(/can-hit/);
    await h.snap(ava, 'Blue 7: own 7s and the 3–6 Sequence light up');
    await pick(ava, 'B7_1', 'Y12_1');
    await expect(ava.locator('.meld-spread.can-hit')).toHaveCount(0);
    await h.snap(ava, 'Yellow 12: nothing lights up');
  });

  test('add a card to your own Group', async ({ h }) => {
    const g = laidTable(['B7', 'Y12', 'Y8']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'B7_1');
    await pile(ava, 'ava-7s').click();
    await expect(hand(ava, 'B7_1')).toHaveCount(0);
    await expect(pile(ava, 'ava-7s').locator('[data-meld-card]')).toHaveCount(4);
    await h.snap(ava, 'Four 7s');
  });

  test("add a card to another player's Group", async ({ h }) => {
    const g = laidTable(['B10', 'Y12', 'Y8']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    const ben = await h.open({ code: g.code, seat: g.seats[1] });
    await pick(ava, 'B10_1');
    await pile(ava, 'ben-10s').click();
    await expect(pile(ava, 'ben-10s').locator('[data-meld-card]')).toHaveCount(4);
    await expect(pile(ben, 'ben-10s').locator('[data-meld-card]')).toHaveCount(4);
    await h.snap(ben, "Ben's Group of 10s grew");
  });

  test('add a Wild to a Group', async ({ h }) => {
    const g = laidTable(['W', 'Y12', 'Y8']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'W_1');
    await expect(ava.locator('.meld-spread.can-hit')).toHaveCount(4);
    await h.snap(ava, 'A Wild fits every pile');
    await pile(ava, 'ava-11s').click();
    await expect(pile(ava, 'ava-11s').locator('[data-meld-card]')).toHaveCount(4);
  });

  test('extend a Sequence at either end', async ({ h }) => {
    const g = laidTable(['Y2', 'R7', 'Y12']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'Y2_1');
    await pile(ava, 'ben-run').click();
    await expect(pile(ava, 'ben-run')).toContainText('Sequence 2–6');
    await pick(ava, 'R7_1');
    await pile(ava, 'ben-run').click();
    await expect(pile(ava, 'ben-run')).toContainText('Sequence 2–7');
    await h.snap(ava, 'Sequence 2–7');
  });

  test('add several cards to a Sequence at once, with a Wild', async ({ h }) => {
    const g = laidTable(['R7', 'W', 'B9', 'Y12']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R7_1', 'W_1', 'B9_1');
    await expect(pile(ava, 'ben-run')).toHaveClass(/can-hit/);
    await h.snap(ava, '7, Wild and 9 selected');
    await pile(ava, 'ben-run').click();
    await expect(pile(ava, 'ben-run')).toContainText('Sequence 3–9');
    await expect(pile(ava, 'ben-run').locator('[data-meld-card]')).toHaveCount(7);
    await h.snap(ava, 'Sequence 3–9');
  });

  test('a batch that does not all fit is refused, and nothing is played', async ({ h }) => {
    const g = laidTable(['R7', 'B9', 'Y12']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R7_1', 'B9_1');
    await expect(pile(ava, 'ben-run')).not.toHaveClass(/can-hit/);
    await h.snap(ava, '7 and 9 leave a gap: no highlight');
    const res = await act(g.code, g.seats[0], 'hit', { cardIds: ['R7_1', 'B9_1'], meldId: 'ben-run' });
    expect(res.json.error).toBe('All selected cards must extend the Sequence without gaps (1–12).');
    const room = stored(g.code);
    expect(room.players[0].hand).toHaveLength(3);
    expect(room.melds.find((m: { id: string }) => m.id === 'ben-run').cards).toHaveLength(4);
    await h.note('Response', res.json);
  });

  test('a Sequence cannot pass 12 (server)', async ({ h }) => {
    const g = game({ hand: ['W', 'R8'], hasLaidPhase: true }, { melds: [{ id: 'top', owner: 0, type: 'sequence', cards: ['R9', 'B10', 'G11', 'Y12'] }] });
    const over = await act(g.code, g.seats[0], 'hit', { cardIds: ['W_1'], meldId: 'top', declaredValue: 13 });
    expect(over.ok).toBe(false);
    const under = await act(g.code, g.seats[0], 'hit', { cardIds: ['W_1'], meldId: 'top', declaredValue: 8 });
    expect(under.ok).toBe(true);
    await h.note('Responses', { over: over.json, under: 'ok' });
  });

  test('a Skip cannot be added to a pile (server)', async ({ h }) => {
    const g = laidTable(['S', 'Y12']);
    const res = await act(g.code, g.seats[0], 'hit', { cardIds: ['S_1'], meldId: 'ava-7s' });
    expect(res.json.error).toBe('Skip cards cannot be added to a pile.');
    await h.note('Response', res.json);
  });

  test('add to a one-color pile', async ({ h }) => {
    const g = game({ phase: 8, hasLaidPhase: true, hand: ['B5', 'R5', 'Y1'] }, { melds: [{ id: 'blue', owner: 0, type: 'color', cards: ['B1', 'B2', 'B4', 'B6', 'B8', 'B10', 'B12'] }] });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R5_1');
    await expect(pile(ava, 'blue')).not.toHaveClass(/can-hit/);
    await pick(ava, 'R5_1', 'B5_1');
    await pile(ava, 'blue').click();
    await expect(pile(ava, 'blue').locator('[data-meld-card]')).toHaveCount(8);
    await h.snap(ava, 'Blue 5 added; red 5 would not fit');
  });

  test('drag a card onto a pile', async ({ h }) => {
    const g = laidTable(['B7', 'Y12', 'Y8']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await dragTo(ava, hand(ava, 'B7_1'), pile(ava, 'ava-7s'), { release: false });
    await expect(pile(ava, 'ava-7s')).toHaveClass(/can-hit/);
    await expect(pile(ava, 'ben-10s')).not.toHaveClass(/can-hit/);
    await h.snap(ava, 'Dragging the 7: legal piles glow');
    await ava.mouse.up();
    await expect(pile(ava, 'ava-7s').locator('[data-meld-card]')).toHaveCount(4);
    await h.snap(ava, 'Dropped on the 7s');
  });

  test('drag a selected batch onto a pile', async ({ h }) => {
    const g = laidTable(['R7', 'W', 'B9', 'Y12']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R7_1', 'W_1', 'B9_1');
    await dragTo(ava, hand(ava, 'W_1'), pile(ava, 'ben-run'));
    await expect(pile(ava, 'ben-run')).toContainText('Sequence 3–9');
    await h.snap(ava, 'Batch dropped on the Sequence');
  });

  test('dropping on an illegal pile does nothing', async ({ h }) => {
    const g = laidTable(['Y12', 'B2', 'Y8']);
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await dragTo(ava, hand(ava, 'Y12_1'), pile(ava, 'ava-7s'));
    await ava.waitForTimeout(500);
    await expect(hand(ava, 'Y12_1')).toBeVisible();
    expect(stored(g.code).players[0].hand).toHaveLength(3);
    await expect(turnStatus(ava)).toHaveText('Finish your turn: lay cards down, add to a pile, or discard');
    await h.snap(ava, 'Yellow 12 stays in hand');
  });

  test('lay down and add to piles in the same turn', async ({ h }) => {
    const g = game({ hand: ['R5', 'B5', 'G5', 'R9', 'Y9', 'B9', 'Y5', 'W', 'R10', 'B12', 'Y6'] }, { ben: { phase: 2, hasLaidPhase: true }, melds: TABLE.filter(m => m.owner === 1) });
    const ava = await h.open({ code: g.code, seat: g.seats[0] });
    await pick(ava, 'R5_1', 'B5_1', 'G5_1', 'R9_1', 'Y9_1', 'B9_1');
    await ava.getByTestId('button-lay-phase').click();
    await expect(laid(ava, g.seats[0].id)).toHaveCount(2);
    await pick(ava, 'Y5_1');
    await laid(ava, g.seats[0].id).filter({ hasText: 'Group of 5s' }).click();
    await pick(ava, 'R10_1');
    await pile(ava, 'ben-10s').click();
    await expect(ava.locator('[data-testid^="card-in-hand-"]')).toHaveCount(3);
    await expect(turnStatus(ava)).toHaveText('Finish your turn: lay cards down, add to a pile, or discard');
    await h.snap(ava, 'Laid, then added to own and Ben’s piles');
  });
});
