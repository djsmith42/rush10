import { act, api, expect, seed, stored, test, view } from '../lib/harness';

const AVATAR_NAME: Record<string, string> = { fox: 'Fox', cat: 'Cat', bear: 'Bear', rabbit: 'Rabbit', owl: 'Owl', panda: 'Panda', frog: 'Frog', penguin: 'Penguin' };
const row = (page: import('@playwright/test').Page, id: string) => page.getByTestId(`player-row-${id}`);

test.describe('Lobby', () => {
  test('adding a bot', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }] });
    const page = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    await page.getByTestId('button-add-bot').click();
    await expect(page.getByText('Botley')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: "Botley's skill level" }).getByRole('radio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('button-start-game')).toBeEnabled();
    await h.snap(page, 'Bot added at Medium');
  });

  test('changing a bot skill level', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Botley', isBot: true }] });
    const page = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    const levels = page.getByRole('radiogroup', { name: "Botley's skill level" });
    await levels.getByRole('radio', { name: 'Hard' }).click();
    await expect(levels.getByRole('radio', { name: 'Hard' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => stored(code).players[1].botLevel).toBe('hard');
    await levels.getByRole('radio', { name: 'Easy' }).click();
    await expect.poll(() => stored(code).players[1].botLevel).toBe('easy');
    await h.snap(page, 'Bot set to Easy');
  });

  test('removing a bot', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Botley', isBot: true }, { name: 'Chip', isBot: true }] });
    const page = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    await h.snap(page, 'Two bots');
    await page.getByRole('button', { name: 'Remove Botley' }).click();
    await expect(page.getByText('Botley')).toHaveCount(0);
    await expect(page.getByText('Chip', { exact: true })).toBeVisible();
    expect(stored(code).players.map((p: { name: string }) => p.name)).toEqual(['Ava', 'Chip']);
    await h.snap(page, 'Botley removed');
  });

  test('filling the game with bots hides Add a bot at six players', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }] });
    const page = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    for (let count = 2; count <= 6; count++) {
      await page.getByTestId('button-add-bot').click();
      await expect(page.locator('[data-testid^="player-row-"]')).toHaveCount(count);
    }
    await expect(page.getByTestId('button-add-bot')).toHaveCount(0);
    await expect(page.getByText('Waiting for a player...')).toHaveCount(0);
    const names = stored(code).players.map((p: { name: string }) => p.name);
    expect(new Set(names).size).toBe(6);
    await h.snap(page, 'Six players, no more bots');
  });

  test('guests cannot change bots', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }, { name: 'Botley', isBot: true }] });
    const page = await h.open({ code, seat: seats[1] }, { waitFor: 'lobby' });
    await expect(page.getByTestId('button-add-bot')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove Botley' })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: "Botley's skill level" })).toHaveCount(0);
    await expect(page.getByText('Medium bot')).toBeVisible();
    const refused = await act(code, seats[1], 'add-bot');
    expect(refused.status).toBe(403);
    await h.note('Guest add-bot via API', refused.json);
    await h.snap(page, 'Guest view of a bot');
  });

  test('multiple players join and everyone sees them live', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }] });
    const host = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    const ben = await h.open(undefined, { path: `/join/${code}` });
    await ben.getByTestId('input-player-name').fill('Ben');
    await ben.getByTestId('button-enter-name').click();
    await expect(ben.getByText('Invite players to join')).toBeVisible();
    const cleo = await api(`/rooms/${code}/join`, { body: { playerName: 'Cleo' } });
    const dev = await api(`/rooms/${code}/join`, { body: { playerName: 'Dev' } });
    expect(cleo.ok && dev.ok).toBe(true);
    for (const page of [host, ben]) {
      await expect(page.locator('[data-testid^="player-row-"]')).toHaveCount(4);
      await expect(page.locator('[data-testid^="player-row-"]')).toContainText(['Ava', 'Ben', 'Cleo', 'Dev']);
    }
    await h.snap(host, 'Host sees four players');
    await h.snap(ben, 'Ben sees four players');
  });

  test('a player who leaves the lobby page stays seated and can reconnect', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const host = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    const ben = await h.open({ code, seat: seats[1] }, { waitFor: 'lobby' });
    await ben.getByRole('button', { name: 'Back to Rush 10' }).click();
    await expect(ben.getByTestId('button-reconnect')).toContainText(code);
    await h.snap(ben, 'Ben left the lobby page');
    await expect(row(host, seats[1].id)).toBeVisible();
    await h.snap(host, 'Ben still listed for the host');
    await ben.getByTestId('button-reconnect').click();
    await expect(ben.getByText('Invite players to join')).toBeVisible();
    await h.snap(ben, 'Ben reconnected');
  });

  test('a guest leaves the lobby: their seat is freed', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }, { name: 'Cleo' }] });
    const host = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    const ben = await h.open({ code, seat: seats[1] }, { waitFor: 'lobby' });
    await h.snap(ben, 'Ben in the lobby, with Leave game');
    await ben.getByTestId('button-leave-lobby').click();
    await expect(ben.getByTestId('button-create-room')).toBeVisible();
    await ben.waitForTimeout(500);
    await expect(ben.getByTestId('button-reconnect')).toHaveCount(0);
    await h.snap(ben, 'Ben is home, with no reconnect offer');
    await expect(row(host, seats[1].id)).toHaveCount(0);
    await expect(host.locator('[data-testid^="player-row-"]')).toHaveCount(2);
    expect(stored(code).players.map((p: { name: string }) => p.name)).toEqual(['Ava', 'Cleo']);
    await h.snap(host, 'Ben is gone for the host');
  });

  test('a player who left can join again as a new player', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    await act(code, seats[1], 'leave');
    const again = await api(`/rooms/${code}/join`, { body: { playerName: 'Ben' } });
    expect(again.ok).toBe(true);
    const old = await view(code, seats[1]);
    expect(old.error).toBe('That player session is not valid for this game.');
    await h.note('Old seat after rejoining', old);
  });

  test('the host leaves: the next player becomes host', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Botley', isBot: true }, { name: 'Ben' }, { name: 'Cleo' }] });
    const ava = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    const ben = await h.open({ code, seat: seats[2] }, { waitFor: 'lobby' });
    await expect(ben.getByTestId('button-start-game')).toHaveCount(0);
    await ava.getByTestId('button-leave-lobby').click();
    await expect(ava.getByTestId('button-create-room')).toBeVisible();
    await expect(ben.getByTestId('button-start-game')).toBeEnabled();
    await expect(ben.getByTestId('button-add-bot')).toBeVisible();
    await expect(row(ben, seats[2].id).getByLabel('Host')).toBeVisible();
    const room = stored(code);
    expect(room.hostPlayerId).toBe(seats[2].id);
    expect(room.players.filter((p: { isHost: boolean }) => p.isHost).map((p: { name: string }) => p.name)).toEqual(['Ben']);
    await h.snap(ben, 'Ben is host now (not the bot)');
  });

  test('the last person leaves: the lobby closes', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Botley', isBot: true }] });
    const ava = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    await ava.getByTestId('button-leave-lobby').click();
    await expect(ava.getByTestId('button-create-room')).toBeVisible();
    const room = stored(code);
    expect([room.status, room.players.length]).toEqual(['finished', 0]);
    const join = await api(`/rooms/${code}/join`, { body: { playerName: 'Ben' } });
    expect(join.json.error).toBe('This game has ended.');
    await h.snap(ava, 'Home after closing the lobby');
  });

  test('a seventh player is refused', async ({ h }) => {
    const { code } = seed({ status: 'waiting', players: ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli'].map(name => ({ name })) });
    const page = await h.open(undefined, { path: `/join/${code}` });
    await page.getByTestId('input-player-name').fill('Fay');
    const late = await api(`/rooms/${code}/join`, { body: { playerName: 'Gus' } });
    expect(late.ok).toBe(true);
    await page.getByTestId('button-enter-name').click();
    await expect(page.getByRole('alert')).toHaveText('This game already has six players.');
    await h.snap(page, 'Seventh player refused');
  });

  test('changing your name updates for everyone', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const host = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    const ben = await h.open({ code, seat: seats[1] }, { waitFor: 'lobby' });
    await ben.getByTestId('input-edit-name').fill('Benjamin');
    await h.snap(ben, 'Typing a new name');
    await expect.poll(() => stored(code).players[1].name).toBe('Benjamin');
    await expect(row(host, seats[1].id)).toContainText('Benjamin');
    await h.snap(host, 'Host sees Benjamin');
  });

  test('Enter commits a name change immediately', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const ben = await h.open({ code, seat: seats[1] }, { waitFor: 'lobby' });
    await ben.getByTestId('input-edit-name').fill('B');
    await ben.getByTestId('input-edit-name').press('Enter');
    await expect.poll(() => stored(code).players[1].name, { timeout: 1500 }).toBe('B');
    await h.snap(ben, 'Saved on Enter');
  });

  test('an empty name is not saved and reverts', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const ben = await h.open({ code, seat: seats[1] }, { waitFor: 'lobby' });
    await ben.getByTestId('input-edit-name').fill('');
    await ben.getByTestId('input-edit-name').blur();
    await expect(ben.getByTestId('input-edit-name')).toHaveValue('Ben');
    expect(stored(code).players[1].name).toBe('Ben');
    const res = await act(code, seats[1], 'set-name', { playerName: '  ' });
    expect(res.json.error).toBe('Enter a player name.');
    await h.snap(ben, 'Empty name reverted');
  });

  test('every player gets a different avatar on arrival', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: ['Ava', 'Ben', 'Cleo', 'Dev'].map(name => ({ name, avatar: 'fox' })) });
    const pages = await Promise.all(seats.map(seat => h.open({ code, seat }, { waitFor: 'lobby' })));
    await expect.poll(() => new Set(stored(code).players.map((p: { avatar: string }) => p.avatar)).size).toBe(4);
    await h.snap(pages[0], 'Four distinct avatars');
  });

  test('changing your avatar updates for everyone', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const host = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    const ben = await h.open({ code, seat: seats[1] }, { waitFor: 'lobby' });
    await expect.poll(async () => (await view(code, seats[1])).players[1].avatar).not.toBe(undefined);
    const taken = new Set(stored(code).players.map((p: { avatar: string }) => p.avatar));
    const choice = Object.keys(AVATAR_NAME).find(kind => !taken.has(kind))!;
    await ben.getByTestId(`button-avatar-${choice}`).click();
    await expect(ben.getByTestId(`button-avatar-${choice}`)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => stored(code).players[1].avatar).toBe(choice);
    await expect(row(host, seats[1].id).getByRole('img', { name: `${AVATAR_NAME[choice]} avatar` })).toBeVisible();
    await h.snap(ben, `Ben picked ${AVATAR_NAME[choice]}`);
    await h.snap(host, 'Host sees the new avatar');
  });

  test("another player's avatar cannot be chosen", async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    const ben = await h.open({ code, seat: seats[1] }, { waitFor: 'lobby' });
    await expect.poll(() => stored(code).players.every((p: { avatar?: string }) => p.avatar)).toBe(true);
    await ben.waitForTimeout(1000);
    const avaAvatar = stored(code).players[0].avatar;
    await expect(ben.getByTestId(`button-avatar-${avaAvatar}`)).toBeDisabled();
    await expect(ben.getByTestId(`button-avatar-${avaAvatar}`)).toHaveAttribute('title', `${AVATAR_NAME[avaAvatar]} (taken by Ava)`);
    const res = await act(code, seats[1], 'set-avatar', { avatar: avaAvatar });
    expect(res.json.error).toBe('That avatar is already taken. Choose another.');
    await h.snap(ben, "Ava's avatar is greyed out for Ben");
  });

  test('copy game code', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }] });
    const page = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy game code' }).click();
    await expect(page.getByRole('button', { name: 'Game code copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await h.snap(page, 'Code copied');
  });

  test('only the host can start the game', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const ben = await h.open({ code, seat: seats[1] }, { waitFor: 'lobby' });
    await expect(ben.getByTestId('button-start-game')).toHaveCount(0);
    const res = await api(`/rooms/${code}/start`, { body: { playerToken: seats[1].token } });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('Only the host can start the game.');
    await h.snap(ben, 'Guest waits for the host');
  });

  test('a lone host cannot start', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }] });
    const res = await api(`/rooms/${code}/start`, { body: { playerToken: seats[0].token } });
    expect(res.json.error).toBe('At least two players are needed to start.');
    await h.note('start with one player', res.json);
  });

  test('starting deals ten cards each and takes everyone to the table', async ({ h }) => {
    const { code, seats } = seed({ status: 'waiting', players: [{ name: 'Ava' }, { name: 'Ben' }, { name: 'Cleo' }] });
    const pages = await Promise.all(seats.map(seat => h.open({ code, seat }, { waitFor: 'lobby' })));
    await pages[0].getByTestId('button-start-game').click();
    for (const page of pages) {
      await expect(page.getByTestId('game-table')).toBeVisible();
      await expect(page.locator('[data-testid^="card-in-hand-"]')).toHaveCount(10);
    }
    const room = stored(code);
    expect(room.status).toBe('playing');
    expect(room.players.map((p: { hand: unknown[] }) => p.hand.length)).toEqual([10, 10, 10]);
    expect(room.discardPile).toHaveLength(1);
    expect(room.drawPile).toHaveLength(108 - 31);
    expect(room.currentPlayerId).toBe(seats[0].id);
    await expect(pages[0].getByTestId('text-turn-status')).toHaveText('Your turn. Draw a card.');
    await expect(pages[1].getByTestId('text-turn-status')).toContainText('Ava is drawing');
    await h.snap(pages[0], "Ava's table (her turn)");
    await h.snap(pages[1], "Ben's table");
  });

  test('names and avatars are locked once the game starts (server)', async ({ h }) => {
    const { code, seats } = seed({ players: [{ name: 'Ava', hand: ['R1'] }, { name: 'Ben', hand: ['R2'] }] });
    const name = await act(code, seats[0], 'set-name', { playerName: 'Zed' });
    const avatar = await act(code, seats[0], 'set-avatar', { avatar: 'owl' });
    const bot = await act(code, seats[0], 'add-bot');
    expect(name.json.error).toBe("Names can't be changed once the game has started.");
    expect(avatar.json.error).toBe('Choose your avatar before the game starts.');
    expect(bot.json.error).toBe('Bots can only be changed before the game starts.');
    await h.note('Responses', { name: name.json, avatar: avatar.json, bot: bot.json });
  });
});
