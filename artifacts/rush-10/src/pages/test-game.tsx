import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  createRush10Room, joinRush10Room, actInRush10Game, startRush10Game, getRush10Room,
  useGetRush10Room, useGetRush10Rules, getGetRush10RoomQueryKey,
  type Rush10RoomSession,
} from '@workspace/api-client-react';
import { GameTable, type Perform } from '@/components/game/game-table';

type Session = Pick<Rush10RoomSession, 'roomCode' | 'playerToken' | 'playerId'>;
const KEY = 'rush10-test-game-sessions';
let setup: Promise<Session[]> | undefined;

// Keep test identities separate from the normal game session. Save each setup
// step so a failed request can be retried without creating duplicate players.
function prepareGame(): Promise<Session[]> {
  if (setup) return setup;
  setup = (async () => {
    const raw = localStorage.getItem(KEY);
    const sessions: Session[] = raw ? JSON.parse(raw) : [];
    const save = () => localStorage.setItem(KEY, JSON.stringify(sessions));
    const identity = ({ roomCode, playerToken, playerId }: Session): Session => ({ roomCode, playerToken, playerId });
    if (!sessions.length) {
      sessions.push(identity(await createRush10Room({ playerName: 'Player 1' })));
      save();
    }
    const host = sessions[0];
    if (sessions.length === 1) {
      sessions.push(identity(await joinRush10Room(host.roomCode, { playerName: 'Player 2' })));
      save();
    }
    const room = await getRush10Room(host.roomCode, { playerToken: host.playerToken });
    if (room.status === 'waiting') {
      await actInRush10Game(host.roomCode, { playerToken: host.playerToken, action: 'set-avatar', avatar: 'fox' });
      await actInRush10Game(host.roomCode, { playerToken: sessions[1].playerToken, action: 'set-avatar', avatar: 'panda' });
      await startRush10Game(host.roomCode, { playerToken: host.playerToken });
    }
    return sessions;
  })().finally(() => { setup = undefined; });
  return setup;
}

export default function TestGamePage() {
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [perspective, setPerspective] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const session = sessions[perspective];
  const code = session?.roomCode ?? '';
  const token = session?.playerToken ?? '';
  const key = getGetRush10RoomQueryKey(code, { playerToken: token });
  const roomQuery = useGetRush10Room(code, { playerToken: token }, {
    query: { enabled: !!token, queryKey: key, refetchInterval: busy ? false : 1200 },
  });
  const rules = useGetRush10Rules();

  async function initialize() {
    setLoading(true);
    setError('');
    try { setSessions(await prepareGame()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create the test game.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void initialize(); }, []);

  const perform: Perform = async (action, extra, onDone) => {
    if (!session || busy) return;
    setBusy(true);
    setError('');
    try {
      await client.cancelQueries({ queryKey: key });
      const updated = await actInRush10Game(code, { ...extra, action, playerToken: token });
      client.setQueryData(key, updated);
      onDone?.(updated);
    } catch (e) { setError(e instanceof Error ? e.message : 'The move failed.'); }
    finally { setBusy(false); }
  };
  async function start() {
    if (!session || busy) return;
    setBusy(true);
    setError('');
    try {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, await startRush10Game(code, { playerToken: token }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the next round.'); }
    finally { setBusy(false); }
  }

  return <div className="test-game-page">
    <div role="toolbar" aria-label="Test game perspective" className="sticky top-0 z-[200] flex flex-wrap items-center gap-3 border-b border-gray-400 bg-gray-100 px-4 py-3 font-sans text-sm text-gray-900">
      <strong>Test game</strong>
      {[0, 1].map(index => <button key={index} disabled={loading || busy || !sessions.length}
        aria-pressed={perspective === index} onClick={() => setPerspective(index)}
        className={`rounded border border-gray-500 px-3 py-1.5 disabled:opacity-50 ${perspective === index ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}>
        Player {index + 1}
      </button>)}
      <span>{sessions.length ? `Viewing Player ${perspective + 1}` : 'Setting up two players…'}</span>
      <span className="ml-auto text-xs text-gray-600">Testing tools only · Normal game session unchanged</span>
      <button onClick={() => navigate('/')} className="underline">Home</button>
    </div>
    {error && <div role="alert" className="flex items-center gap-4 bg-red-100 px-4 py-3 text-red-900">
      {error}<button className="underline" onClick={() => sessions.length ? setError('') : void initialize()}>{sessions.length ? 'Dismiss' : 'Retry setup'}</button>
    </div>}
    {loading || (!!token && !roomQuery.data && roomQuery.isLoading) ? <p role="status" className="p-8">Loading the two-player game…</p>
      : roomQuery.isError ? <div role="alert" className="p-8">Could not load the test game. <button className="underline" onClick={() => roomQuery.refetch()}>Retry</button></div>
      : roomQuery.data && session ? <GameTable key={session.playerId} room={roomQuery.data} code={code} selfId={session.playerId} hideRoomCode
        rules={rules.data} rulesLoading={rules.isLoading} retryRules={() => { void rules.refetch(); }}
        perform={perform} start={() => { void start(); }} isBusy={busy} actPending={busy} startPending={busy}
        onExit={() => navigate('/')} /> : null}
  </div>;
}
