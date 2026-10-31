import { expect, rig, seed, stored, test, unusedCode } from '../lib/harness';

test.describe('Home and creating a game', () => {
  test('home page shows the hero, Create and Join', async ({ h }) => {
    const page = await h.open();
    await expect(page.getByRole('heading', { name: 'RUSH 10' })).toBeVisible();
    await expect(page.getByText('A free card game for 2–6 players')).toBeVisible();
    await expect(page.getByTestId('button-create-room')).toBeVisible();
    await expect(page.getByTestId('input-room-code')).toBeVisible();
    await expect(page.getByTestId('button-reconnect')).toHaveCount(0);
    await h.snap(page, 'Home page');
  });

  test('home page fits a phone screen', async ({ h }) => {
    const page = await h.open(undefined, { viewport: { width: 390, height: 844 } });
    await expect(page.getByTestId('button-create-room')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await h.snap(page, 'Home on a phone');
  });

  test('create a game: name page, then the lobby as host', async ({ h }) => {
    const page = await h.open();
    await page.getByTestId('button-create-room').click();
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.getByTestId('button-enter-name')).toBeDisabled();
    await h.snap(page, 'Name page, empty name: Create disabled');
    await page.getByTestId('input-player-name').fill('Ava');
    await h.snap(page, 'Name entered');
    await page.getByTestId('button-enter-name').click();
    await expect(page.getByText('Invite players to join')).toBeVisible();
    const code = page.url().match(/\/game\/([A-Z]{4})$/)![1];
    await expect(page.getByRole('button', { name: 'Copy game code' })).toContainText(`Game code: ${code}`);
    await expect(page.getByText('Need at least one more player')).toBeVisible();
    await expect(page.getByTestId('button-start-game')).toBeDisabled();
    const room = stored(code);
    expect(room.status).toBe('waiting');
    expect(room.players.map((p: { name: string; isHost: boolean }) => [p.name, p.isHost])).toEqual([['Ava', true]]);
    expect(code).toMatch(/^[ABCDEFGHJKMNPRSTUVWXYZ]{4}$/);
    await h.snap(page, 'Lobby as host');
  });

  test('a whitespace-only name cannot create a game', async ({ h }) => {
    const page = await h.open(undefined, { path: '/new' });
    await page.getByTestId('input-player-name').fill('   ');
    await expect(page.getByTestId('button-enter-name')).toBeDisabled();
    await h.snap(page, 'Spaces only: Create disabled');
  });

  test('Enter in the name field does not create a game', async ({ h }) => {
    const page = await h.open(undefined, { path: '/new' });
    await page.getByTestId('input-player-name').fill('Ava');
    await page.getByTestId('input-player-name').press('Enter');
    await page.waitForTimeout(800);
    await h.snap(page, 'After pressing Enter in the name field');
    await expect(page).toHaveURL(/\/new$/);
  });

  test('the last name used is remembered', async ({ h }) => {
    const page = await h.open(undefined, { path: '/new' });
    await page.getByTestId('input-player-name').fill('Remembered');
    await page.getByTestId('button-enter-name').click();
    await expect(page.getByText('Invite players to join')).toBeVisible();
    await page.goto('/new');
    await expect(page.getByTestId('input-player-name')).toHaveValue('Remembered');
    await h.snap(page, 'Name prefilled from last time');
  });

  test('back arrow returns home from the name page', async ({ h }) => {
    const page = await h.open(undefined, { path: '/new' });
    await page.getByRole('button', { name: 'Back to Rush 10' }).click();
    await expect(page.getByTestId('button-create-room')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await h.snap(page, 'Back home');
  });

  test('unknown routes show a not-found page', async ({ h }) => {
    const page = await h.open(undefined, { path: '/no-such-page' });
    await expect(page.getByTestId('button-create-room')).toHaveCount(0);
    await h.snap(page, 'Not found');
  });
});

test.describe('Joining a game', () => {
  const lobby = () => seed({ status: 'waiting', players: [{ name: 'Ava' }] });

  test('missing game code', async ({ h }) => {
    const page = await h.open();
    await page.getByTestId('button-join-room').click();
    await expect(page.getByRole('alert')).toHaveText('Enter a valid four-letter game code.');
    await h.snap(page, 'No code entered');
  });

  test('too-short game code', async ({ h }) => {
    const page = await h.open();
    await page.getByTestId('input-room-code').fill('AB');
    await page.getByTestId('button-join-room').click();
    await expect(page.getByRole('alert')).toHaveText('Enter a valid four-letter game code.');
    await h.snap(page, 'Two letters');
  });

  test('code with disallowed characters', async ({ h }) => {
    const page = await h.open();
    await page.getByTestId('input-room-code').fill('AB1O');
    await page.getByTestId('button-join-room').click();
    await expect(page.getByRole('alert')).toHaveText('Enter a valid four-letter game code.');
    await h.snap(page, 'Digits and look-alike letters rejected');
  });

  test('code input uppercases and stops at four letters', async ({ h }) => {
    const page = await h.open();
    await page.getByTestId('input-room-code').fill('abcdef');
    await expect(page.getByTestId('input-room-code')).toHaveValue('ABCD');
    await h.snap(page, 'Typed abcdef');
  });

  test('bad game code: no game with that code', async ({ h }) => {
    const page = await h.open();
    const code = unusedCode();
    await page.getByTestId('input-room-code').fill(code);
    await page.getByTestId('button-join-room').click();
    await expect(page.getByRole('alert')).toHaveText("There's no game with that code");
    await expect(page).toHaveURL(/\/$/);
    await h.snap(page, 'Nonexistent code');
  });

  test('good game code: join and appear in the lobby', async ({ h }) => {
    const { code, seats } = lobby();
    const host = await h.open({ code, seat: seats[0] }, { waitFor: 'lobby' });
    const page = await h.open();
    await page.getByTestId('input-room-code').fill(code.toLowerCase());
    await page.getByTestId('button-join-room').click();
    await expect(page).toHaveURL(new RegExp(`/join/${code}$`));
    await expect(page.getByTestId('text-joining-players')).toHaveText('Joining a game with Ava');
    await page.getByTestId('input-player-name').fill('Ben');
    await h.snap(page, 'Name page shows who is in the game');
    await page.getByTestId('button-enter-name').click();
    await expect(page.getByText('Invite players to join')).toBeVisible();
    await expect(page.getByText('Waiting for the host to deal')).toBeVisible();
    await expect(page.getByTestId('button-add-bot')).toHaveCount(0);
    await h.snap(page, 'Guest in lobby');
    await expect(host.getByText('Ben', { exact: true })).toBeVisible();
    await expect(host.getByTestId('button-start-game')).toBeEnabled();
    await h.snap(host, 'Host sees Ben arrive');
  });

  test('Enter in the game code field joins', async ({ h }) => {
    const { code } = lobby();
    const page = await h.open();
    await page.getByTestId('input-room-code').fill(code);
    await page.getByTestId('input-room-code').press('Enter');
    await expect(page).toHaveURL(new RegExp(`/join/${code}$`));
    await h.snap(page, 'Joined with Enter');
  });

  test('cannot join a game that has started', async ({ h }) => {
    const { code } = seed({ players: [{ name: 'Ava', hand: ['R1'] }, { name: 'Ben', hand: ['R2'] }] });
    const page = await h.open();
    await page.getByTestId('input-room-code').fill(code);
    await page.getByTestId('button-join-room').click();
    await expect(page.getByRole('alert')).toContainText('already started');
    await h.snap(page, 'Game already started');
  });

  test('cannot join a full game of six', async ({ h }) => {
    const { code } = seed({ status: 'waiting', players: ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay'].map(name => ({ name })) });
    const page = await h.open();
    await page.getByTestId('input-room-code').fill(code);
    await page.getByTestId('button-join-room').click();
    await expect(page.getByRole('alert')).toHaveText('This game already has six players.');
    await h.snap(page, 'Six players already');
  });

  test('join link for a nonexistent game reports it', async ({ h }) => {
    const page = await h.open(undefined, { path: `/join/${unusedCode()}` });
    const started = Date.now();
    // The lookup retries with backoff before it reports, so this takes several seconds.
    await expect(page.getByRole('alert')).toHaveText("There's no game with that code", { timeout: 15_000 });
    await h.note('Time until the error appeared', `${((Date.now() - started) / 1000).toFixed(1)}s`);
    await h.snap(page, 'Join link, no such game');
  });

  test('malformed join link goes home', async ({ h }) => {
    const page = await h.open(undefined, { path: '/join/12' });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('button-create-room')).toBeVisible();
    await h.snap(page, 'Redirected home');
  });

  test('game is gone while the name page is open', async ({ h }) => {
    const { code } = lobby();
    const page = await h.open(undefined, { path: `/join/${code}` });
    await expect(page.getByTestId('text-joining-players')).toBeVisible();
    rig(code, room => { room.status = 'playing'; });
    await page.getByTestId('input-player-name').fill('Ben');
    await page.getByTestId('button-enter-name').click();
    await expect(page.getByRole('alert')).toContainText('already started');
    await h.snap(page, 'Game started before Join was pressed');
  });

  test('old /room/ links redirect to /game/', async ({ h }) => {
    const { code, seats } = lobby();
    const page = await h.open({ code, seat: seats[0] }, { path: `/room/${code}`, waitFor: 'lobby' });
    await expect(page).toHaveURL(new RegExp(`/game/${code}$`));
    await h.snap(page, 'Redirected to /game/');
  });

  test('a game page without a saved seat asks for the seat token', async ({ h }) => {
    const { code } = lobby();
    const page = await h.open(undefined, { path: `/game/${code}` });
    await expect(page.getByText('You’ll need your seat token.')).toBeVisible();
    await h.snap(page, 'No saved seat');
  });

  test('reconnect from home to a game in progress', async ({ h }) => {
    const { code, seats } = seed({ players: [{ name: 'Ava', hand: ['R1', 'R2'] }, { name: 'Ben', hand: ['B1'] }] });
    const page = await h.open({ code, seat: seats[0] }, { path: '/', waitFor: 'none' });
    await expect(page.getByTestId('button-reconnect')).toContainText(code);
    await h.snap(page, 'Reconnect offered');
    await page.getByTestId('button-reconnect').click();
    await expect(page.getByTestId('game-table')).toBeVisible();
    await h.snap(page, 'Back at the table');
  });

  test('no reconnect offer once the saved game has finished', async ({ h }) => {
    const { code, seats } = seed({ status: 'finished', players: [{ name: 'Ava' }, { name: 'Ben' }] });
    const page = await h.open({ code, seat: seats[0] }, { path: '/', waitFor: 'none' });
    await expect(page.getByTestId('button-create-room')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('button-reconnect')).toHaveCount(0);
    await h.snap(page, 'Finished game: no reconnect');
  });
});
