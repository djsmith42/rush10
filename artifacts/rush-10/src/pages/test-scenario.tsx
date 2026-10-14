import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  actInRush10Game, createRush10TestRoom, startRush10Game,
  useGetRush10Room, useGetRush10Rules,
  type Rush10TestRoom, type Rush10TestRoomCreateScenario,
} from '@workspace/api-client-react';
import { GameTable, type Perform } from '@/components/game/game-table';
import { errorMessage } from '@/lib/error-message';
import { playerAuth, roomQueryKey } from '@/lib/room-query';

type EndReason = Exclude<Rush10TestRoomCreateScenario, 'play'>;
const END_REASONS: Array<{ value: EndReason; label: string }> = [
  { value: 'level-10', label: 'Completed Level 10' },
  { value: 'player-left', label: 'Player left' },
];
const PLAYER_COUNTS = [2, 3, 4, 5, 6];
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

const TESTS = [
  { path: '/test/play', title: 'Game in progress', description: 'Random levels and scores, with 2–6 players you choose.' },
  { path: '/test/end', title: 'End of game', description: 'A finished game, ended by Level 10 or by a player leaving.' },
];

/** /test: pick which test screen to open. */
export function TestIndexPage() {
  const [, navigate] = useLocation();
  return <main className="min-h-[100dvh] bg-gray-100 px-4 py-10 font-sans text-gray-900">
    <div className="mx-auto max-w-xl">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Test screens</h1>
        <button onClick={() => navigate('/')} className="text-sm underline">Home</button>
      </div>
      <p className="mt-1 text-sm text-gray-600">Each test creates its own game. Real games are never touched.</p>
      <ul className="mt-6 grid gap-3">
        {TESTS.map(test => <li key={test.path}>
          <button onClick={() => navigate(test.path)} data-testid={`link-test-${test.path.split('/').pop()}`}
            className="w-full rounded border border-gray-400 bg-white px-4 py-3 text-left hover:border-gray-800 hover:bg-gray-50">
            <span className="block font-bold">{test.title} <span className="font-mono text-xs font-normal text-gray-500">{test.path}</span></span>
            <span className="mt-0.5 block text-sm text-gray-600">{test.description}</span>
          </button>
        </li>)}
      </ul>
    </div>
  </main>;
}

/** /test/play: a game in progress at random levels and scores, with a chosen number of players. */
export function TestPlayPage() {
  const [count, setCount] = useState(() => pick(PLAYER_COUNTS));
  return <TestScenario title="Test: game in progress" scenario="play" playerCount={count}
    controls={<label className="flex items-center gap-2">Players
      <select value={count} onChange={e => setCount(Number(e.target.value))} data-testid="select-test-player-count" className="rounded border border-gray-500 bg-white px-2 py-1">
        {PLAYER_COUNTS.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>} />;
}

/** /test/end: a finished game, ended for a chosen (initially random) reason. */
export function TestEndPage() {
  const [reason, setReason] = useState<EndReason>(() => pick(END_REASONS).value);
  const [count, setCount] = useState(() => pick(PLAYER_COUNTS));
  return <TestScenario title="Test: end of game" scenario={reason} playerCount={count}
    reseedLabel="New random end-of-game" onReseed={() => { setReason(pick(END_REASONS).value); setCount(pick(PLAYER_COUNTS)); }}
    controls={<label className="flex items-center gap-2">Ended by
      <select value={reason} onChange={e => setReason(e.target.value as EndReason)} data-testid="select-test-end-reason" className="rounded border border-gray-500 bg-white px-2 py-1">
        {END_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </label>} />;
}

/** Each scenario is a brand-new seeded room; every seat belongs to this page, never to a real game. */
function TestScenario({ title, scenario, playerCount, controls, reseedLabel = 'New random game', onReseed }: {
  title: string; scenario: Rush10TestRoomCreateScenario; playerCount: number; controls: React.ReactNode;
  reseedLabel?: string; onReseed?: () => void;
}) {
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const [game, setGame] = useState<Rush10TestRoom | null>(null);
  const [perspective, setPerspective] = useState(0);
  const [reseed, setReseed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const session = game?.sessions[perspective];
  const code = game?.roomCode ?? '';
  const token = session?.playerToken ?? '';
  const key = roomQueryKey(code, session?.playerId);
  const roomQuery = useGetRush10Room(code, {
    query: { enabled: !!token, queryKey: key, refetchInterval: busy ? false : 900 },
    request: playerAuth(token),
  });
  const rules = useGetRush10Rules();

  // The table fills the window below the toolbar, whose height changes as it wraps.
  const pageRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const observer = new ResizeObserver(() => pageRef.current?.style.setProperty('--test-toolbar-h', `${toolbar.offsetHeight}px`));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    createRush10TestRoom({ scenario, playerCount })
      .then(created => { if (current) { setGame(created); setPerspective(0); } })
      .catch(e => { if (current) setError(errorMessage(e, 'Could not create the test game.')); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [scenario, playerCount, reseed]);

  const perform: Perform = async (action, extra, onDone, onError) => {
    if (!session || busy) { onError?.(); return; }
    setBusy(true);
    setError('');
    try {
      await client.cancelQueries({ queryKey: key });
      const updated = await actInRush10Game(code, { ...extra, action, playerToken: token });
      client.setQueryData(key, updated);
      onDone?.(updated);
    } catch (e) { setError(errorMessage(e, 'The move failed.')); onError?.(); }
    finally { setBusy(false); }
  };
  async function start() {
    if (!session || busy) return;
    setBusy(true);
    setError('');
    try {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, await startRush10Game(code, { playerToken: token }));
    } catch (e) { setError(errorMessage(e, 'Could not start the next round.')); }
    finally { setBusy(false); }
  }

  return <div ref={pageRef} className="test-game-page">
    <div ref={toolbarRef} role="toolbar" aria-label="Test game controls" className="sticky top-0 z-[200] flex flex-wrap items-center gap-3 border-b border-gray-400 bg-gray-100 px-4 py-3 font-sans text-sm text-gray-900">
      <strong>{title}</strong>
      {controls}
      <button onClick={() => { onReseed?.(); setReseed(n => n + 1); }} disabled={loading || busy} data-testid="button-test-reseed" className="rounded border border-gray-500 bg-white px-3 py-1.5 disabled:opacity-50">{reseedLabel}</button>
      <span className="text-gray-500">View as:</span>
      {game?.sessions.map((seat, index) => {
        // Whose turn it is, so you know which seat to view to make the next move.
        const isTurn = roomQuery.data?.status === 'playing' && roomQuery.data.currentPlayerId === seat.playerId;
        const selected = perspective === index;
        return <button key={seat.playerId} disabled={loading || busy}
          aria-pressed={selected} onClick={() => setPerspective(index)} title={isTurn ? `${seat.name}'s turn` : undefined}
          className={`rounded border px-3 py-1.5 disabled:opacity-50 ${isTurn ? 'border-green-600 ring-1 ring-green-600' : 'border-gray-500'} ${selected ? `bg-gray-800 ${isTurn ? 'text-green-400' : 'text-white'}` : `bg-white ${isTurn ? 'text-green-700' : 'text-gray-900'}`}`}>
          {seat.name}
        </button>;
      })}
      <span className="ml-auto text-xs text-gray-600">Testing tools only · Normal game session unchanged</span>
      <button onClick={() => navigate('/test')} className="underline">All tests</button>
      <button onClick={() => navigate('/')} className="underline">Home</button>
    </div>
    {error && <div role="alert" className="flex items-center gap-4 bg-red-100 px-4 py-3 text-red-900">
      {error}<button className="underline" onClick={() => game ? setError('') : setReseed(n => n + 1)}>{game ? 'Dismiss' : 'Retry setup'}</button>
    </div>}
    {loading || (!!token && !roomQuery.data && roomQuery.isLoading) ? <p role="status" className="p-8">Setting up the test game…</p>
      : roomQuery.isError ? <div role="alert" className="p-8">Could not load the test game. <button className="underline" onClick={() => roomQuery.refetch()}>Retry</button></div>
      : roomQuery.data && session ? <GameTable key={`${code}-${session.playerId}`} room={roomQuery.data} code={code} selfId={session.playerId}
        rules={rules.data} rulesLoading={rules.isLoading} retryRules={() => { void rules.refetch(); }}
        perform={perform} start={() => { void start(); }} isBusy={busy} actPending={busy} startPending={busy}
        onExit={() => navigate('/')} /> : null}
  </div>;
}
