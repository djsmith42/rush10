import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { TestEndPage, TestIndexPage, TestPlayPage } from '@/pages/test-scenario';
import { Redirect, Route, Switch, useLocation, useRoute, Router as WouterRouter } from 'wouter';
import {
  useGetRush10Rules,
  useCreateRush10Room,
  useJoinRush10Room,
  useGetRush10Room,
  useStartRush10Game,
  useActInRush10Game,
  checkRush10RoomJoinable,
  getCheckRush10RoomJoinableQueryKey,
  useCheckRush10RoomJoinable,
} from '@workspace/api-client-react';
import type { Rush10PlayerAction, Rush10RoomSession, Rush10RoomView } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, Bot, Check, Clipboard, Layers, LoaderCircle, RefreshCw, Users, X } from 'lucide-react';
import { SUIT, CARD_FACE, suitLabel, isSpecial, type SuitKey } from '@/components/cards';
import { AvatarPicker, normalizeAvatar, type AvatarKind } from '@/components/avatars';
import { PlayerTile } from '@/components/room-bits';
import { GameTable, type Perform } from '@/components/game/game-table';
import { LobbyCardBackdrop } from '@/components/lobby-card-backdrop';
import { errorMessage } from '@/lib/error-message';
import { playerAuth, roomQueryKey } from '@/lib/room-query';
import { PageTransitionProvider, usePageTransition } from '@/lib/page-transition';

const queryClient = new QueryClient();
const SESSION_KEY = 'rush10-player-session';
const NAME_KEY = 'rush10-player-name';
const ROOM_CODE = /^[ABCDEFGHJKMNPRSTUVWXYZ]{4}$/;
type SavedSession = Pick<Rush10RoomSession, 'roomCode' | 'playerToken' | 'playerId'>;

function readSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedSession>;
    return typeof parsed.roomCode === 'string' && typeof parsed.playerToken === 'string' && typeof parsed.playerId === 'string'
      ? { roomCode: parsed.roomCode, playerToken: parsed.playerToken, playerId: parsed.playerId }
      : null;
  } catch {
    return null;
  }
}

function saveSession(session: Rush10RoomSession) {
  const saved: SavedSession = { roomCode: session.roomCode, playerToken: session.playerToken, playerId: session.playerId };
  localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
}

function readLastName() {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}

function saveLastName(name: string) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* the name is only a convenience */ }
}

function isNotFound(reason: unknown) {
  return typeof reason === 'object' && reason !== null && 'status' in reason && reason.status === 404;
}


function AppRouter() {
  return (
    <ErrorBoundary resetKey={window.location.pathname}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/new" component={NamePage} />
        <Route path="/join/:code" component={NamePage} />
        {/* The API refuses test games in production, so the pages are dev-only too. */}
        {import.meta.env.DEV && (
          <>
            <Route path="/test" component={TestIndexPage} />
            <Route path="/test/play" component={TestPlayPage} />
            <Route path="/test/end" component={TestEndPage} />
            <Route path="/test-game"><Redirect to="/test" replace /></Route>
          </>
        )}
        <Route path="/game/:code" component={RoomPage} />
        <Route path="/room/:code">{params => <Redirect to={`/game/${params.code}`} replace />}</Route>
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function HomePage() {
  const { go } = usePageTransition();
  const [roomCode, setRoomCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [checking, setChecking] = useState(false);
  const saved = readSession();

  async function join(event: FormEvent) {
    event.preventDefault();
    if (checking) return;
    setJoinError('');
    const code = roomCode.trim().toUpperCase();
    if (!ROOM_CODE.test(code)) {
      setJoinError('Enter a valid four-letter game code.');
      return;
    }
    // Check the code here so a typo is caught before asking for a name.
    setChecking(true);
    try {
      await checkRush10RoomJoinable(code);
      go(`/join/${code}`);
    } catch (reason) {
      setJoinError(isNotFound(reason) ? "There's no game with that code" : errorMessage(reason, 'Could not join that game. Check the code.'));
      setChecking(false);
    }
  }
  return (
    <main className="page-shell home-card-background" style={{ '--paper': '#111827' } as CSSProperties}>
      <LobbyCardBackdrop />
      <div className="page-content mx-auto max-w-[1220px] px-5 pb-16 pt-4 md:px-10">
        <section className="home-hero grid items-center gap-12 pb-0 pt-0 md:grid-cols-[1.03fr_.97fr] md:gap-8">
          <div className="home-hero-copy fade-up">
            <h1 className="brand-wordmark origin-left text-[clamp(4.4rem,11vw,9rem)]">
              RUSH 10
            </h1>
            <p className="mt-4 text-[1.4rem] font-semibold text-[#FF3366]">A free online card game for 2–6 players</p>
          </div>
          <HeroFan />
        </section>

        <section className="home-entry mt-12 pt-0 md:mt-16">
          <div className="min-w-0">
            <div className="grid items-start gap-8 md:grid-cols-[1fr_auto_1fr] md:gap-x-4 lg:gap-x-6">
            <div className="mx-auto w-full max-w-sm">
              <h2 className="mb-5 text-2xl font-bold tracking-tight">Create a Game</h2>
              <button type="button" onClick={() => go('/new')} data-testid="button-create-room" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF3366] font-bold text-white shadow-[0_6px_18px_rgba(255,51,102,.35)] transition hover:translate-y-[-1px] hover:bg-[#E62E5C] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-55">
                <Layers size={17} /> Create a game
              </button>
            </div>
            <div className="flex flex-col items-center gap-3 text-2xl text-[#64748B] md:w-10">
              <span aria-hidden="true" className="h-8 w-px bg-current" />
              <span>or</span>
              <span aria-hidden="true" className="h-8 w-px bg-current" />
            </div>
            <form onSubmit={join} noValidate className="mx-auto w-full max-w-sm">
              <h2 className="mb-5 text-2xl font-bold tracking-tight">Join a Game</h2>
              <div className="flex gap-2">
              <input aria-label="Game code" value={roomCode} onChange={(e) => setRoomCode(e.target.value.trim().toUpperCase().slice(0, 4))} required minLength={4} maxLength={4} pattern="[ABCDEFGHJKMNPRSTUVWXYZ]{4}" title="Enter the four-letter game code (no I, L, O, Q or numbers)." autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="GAME CODE" data-testid="input-room-code" className="h-12 min-w-0 flex-1 rounded-xl border border-[#334155] bg-[#0F172A] px-4 font-mono text-sm font-medium uppercase tracking-[.17em] outline-none placeholder:text-[#94A3B8] focus:border-[#2979FF]" />
              <button type="submit" disabled={checking} data-testid="button-join-room" className="flex h-12 items-center gap-2 rounded-xl border-2 border-white/10 px-4 font-bold transition hover:bg-[#A3E635] hover:text-[#111827] hover:border-[#A3E635] disabled:cursor-not-allowed disabled:opacity-45">{checking ? <><LoaderCircle size={16} className="animate-spin" /> Joining…</> : <>Join <ArrowRight size={16} /></>}</button>
              </div>
              {joinError && <p role="alert" className="mt-3 text-sm text-[#FF8FAB]">{joinError}</p>}
              {saved && <button type="button" onClick={() => go(`/game/${saved.roomCode}`)} data-testid="button-reconnect" className="mt-4 flex w-full items-center justify-between gap-2 rounded-xl bg-[#A3E635]/15 px-4 py-3 text-left text-sm font-semibold text-[#A3E635]">
                <span><RefreshCw size={14} className="mr-2 inline" /> Reconnect to game <span className="mono">{saved.roomCode}</span></span><ArrowRight size={16} className="shrink-0" />
              </button>}
            </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function NamePage() {
  const [, navigate] = useLocation();
  const { go } = usePageTransition();
  const queryClient = useQueryClient();
  const [joining, params] = useRoute('/join/:code');
  const code = joining ? (params?.code ?? '').toUpperCase() : '';
  const [playerName, setPlayerName] = useState(readLastName);
  const [error, setError] = useState('');
  const createRoom = useCreateRush10Room();
  const joinRoom = useJoinRush10Room();
  const busy = createRoom.isPending || joinRoom.isPending;
  const validCode = joining && ROOM_CODE.test(code);
  const joinable = useCheckRush10RoomJoinable(code, {
    query: { enabled: validCode, queryKey: getCheckRush10RoomJoinableQueryKey(code), refetchInterval: 3000 },
  });
  const others = joinable.data?.playerNames ?? [];
  const lookupError = joinable.isError
    ? (isNotFound(joinable.error) ? "There's no game with that code" : errorMessage(joinable.error, 'Could not find that game.'))
    : '';

  useEffect(() => {
    if (joining && !validCode) navigate('/', { replace: true });
  }, [joining, validCode]);

  function enter(session: Rush10RoomSession) {
    saveSession(session);
    // The room page renders straight from this instead of a loading skeleton.
    queryClient.setQueryData(roomQueryKey(session.roomCode, session.playerId), session.room);
    go(`/game/${session.roomCode}`);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = playerName.trim();
    if (!name || busy) return;
    setError('');
    saveLastName(name);
    if (joining) {
      joinRoom.mutate({ code, data: { playerName: name } }, {
        onSuccess: enter,
        onError: (reason) => setError(isNotFound(reason) ? "There's no game with that code" : errorMessage(reason, 'Could not join that game. Try again.')),
      });
    } else {
      createRoom.mutate({ data: { playerName: name } }, {
        onSuccess: enter,
        onError: (reason) => setError(errorMessage(reason, 'Could not create a game. Try again.')),
      });
    }
  }

  return (
    <main className="page-shell home-card-background" style={{ '--paper': '#111827' } as CSSProperties}>
      <LobbyCardBackdrop />
      <div className="page-content mx-auto max-w-xl px-5 pb-16 pt-4 md:pt-6">
        <BackHome onClick={() => go('/', { back: true })} />
        <form onSubmit={submit} noValidate className="pt-16 md:pt-24">
          {others.length > 0 && <h1 className="mb-10 text-3xl font-bold tracking-[-.04em] text-white" data-testid="text-joining-players">Joining a game with {new Intl.ListFormat('en', { type: 'conjunction' }).format(others)}</h1>}
          <label className="block">
            <span className="block text-2xl font-bold tracking-[-.04em] text-white">Your Name</span>
            <span className="mb-3 mt-1 block text-sm text-[#94A3B8]">This is what other players will see. You can change this later.</span>
            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} autoFocus maxLength={20} required data-testid="input-player-name" className="h-12 w-full rounded-xl border border-[#334155] bg-[#0F172A] px-4 text-[15px] outline-none transition focus:border-[#FF3366] focus:ring-2 focus:ring-[#FF3366]/15" />
          </label>
          <button type="submit" disabled={busy || !playerName.trim()} data-testid="button-enter-name" className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF3366] font-bold text-white shadow-[0_6px_18px_rgba(255,51,102,.35)] transition hover:translate-y-[-1px] hover:bg-[#E62E5C] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-55">
            {busy ? <LoaderCircle className="animate-spin" size={18} /> : joining ? <ArrowRight size={17} /> : <Layers size={17} />} {joining ? 'Join the game' : 'Create the game'}
          </button>
          {(error || lookupError) && <p role="alert" className="mt-4 rounded-lg bg-[#FF3366]/15 px-3 py-2 text-sm text-[#FF8FAB]">{error || lookupError}</p>}
        </form>
      </div>
    </main>
  );
}

const heroCards = [
  { top: 'RUSH 10', mid: '3', bottom: 'LEVEL 03', suit: 'green' },
  { top: 'RUSH 10', mid: '5', bottom: 'LEVEL 05', suit: 'yellow' },
  { top: 'RUSH 10', mid: '7', bottom: 'LEVEL 07', suit: 'blue' },
  { top: 'WILD', mid: '?', bottom: 'ANY COLOR', suit: 'wild' },
  { top: 'RUSH 10', mid: '10', bottom: 'LEVEL 10', suit: 'red' },
];

/** Top-left way home on the setup screens: a back arrow beside the Rush 10 wordmark. */
function BackHome({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Back to Rush 10" className="-m-1.5 flex items-center gap-3 rounded-2xl border border-transparent p-1.5 pr-3 transition hover:border-white/40 focus-visible:border-white/60 focus-visible:outline-none">
      <span className="flex h-9 w-6 items-center justify-center"><ArrowLeft size={16} /></span>
      <span aria-hidden="true" className="brand-wordmark text-[30px]">RUSH 10</span>
    </button>
  );
}

function HeroFan() {
  const mid = (heroCards.length - 1) / 2;
  return (
    <div className="hero-fan relative mx-auto h-[300px] w-full max-w-[490px] md:h-[365px]" aria-hidden="true">
      {heroCards.map((card, i) => (
        <div key={i} className="hero-slot" style={{ '--r': `${(i - mid) * 11}deg`, '--x': `${(i - mid) * 18}%`, '--y': `${Math.abs(i - mid) * 10}px`, '--sway-d': `${[4.6, 5.9, 5.2, 6.7, 4.9][i]}s`, '--sway-delay': `${[-0.4, -2.1, -3.7, -1.3, -2.9][i]}s`, '--sway-a': `${[6, 8, 5, 9, 7][i]}px`, zIndex: i + 1 } as CSSProperties}>
        <div className="hero-sway">
        <div className="hero-card" style={{ background: isSpecial(card.suit as SuitKey) ? SUIT[card.suit as SuitKey] : CARD_FACE, color: suitLabel(card.suit as SuitKey) } as CSSProperties}>
          <div className="card-lettering text-[18px]">{card.top}</div>
          <div className="card-lettering self-center text-[64px] leading-none tracking-[-.03em] md:text-[78px]">{card.mid}</div>
          <div className="card-lettering text-[16.5px]">{card.bottom}</div>
        </div>
        </div>
        </div>
      ))}
    </div>
  );
}


function RoomPage() {
  const [, params] = useRoute('/game/:code');
  const code = (params?.code ?? '').toUpperCase();
  const { go, leave, phase } = usePageTransition();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<SavedSession | null>(() => readSession());
  const [notice, setNotice] = useState('');
  const [dismissedMessage, setDismissedMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [avatarPulse, setAvatarPulse] = useState(0);
  const [nameDraft, setNameDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const nameTimer = useRef<number | undefined>(undefined);
  const rulesQuery = useGetRush10Rules();
  const token = session?.roomCode.toUpperCase() === code ? session.playerToken : '';
  const roomKey = roomQueryKey(code, session?.playerId);
  const roomQuery = useGetRush10Room(code, {
    query: { enabled: !!code && !!token, queryKey: roomKey, refetchInterval: 900 },
    request: playerAuth(token),
  });
  const startGame = useStartRush10Game();
  const act = useActInRush10Game();
  const room = roomQuery.data;
  // Starting the game plays the page exit before the table appears; reconnecting mid-game goes straight there.
  const sawWaiting = useRef(false);
  if (room?.status === 'waiting') sawWaiting.current = true;
  const [tableShown, setTableShown] = useState(false);
  const leavingLobby = !!room && room.status !== 'waiting' && sawWaiting.current && !tableShown;
  useEffect(() => { if (leavingLobby) leave(() => setTableShown(true)); }, [leavingLobby, leave]);
  const banner = notice || (room?.message !== dismissedMessage ? room?.message : '');

  useEffect(() => { setDismissedMessage(''); }, [room?.message]);
  useEffect(() => {
    if (session && session.roomCode.toUpperCase() !== code) setSession(null);
  }, [code, session]);

  const selfId = session?.playerId;
  const self = room?.players.find((player) => player.id === selfId);
  const isBusy = startGame.isPending || act.isPending;
  const avatarEntry = useRef('');
  useEffect(() => {
    if (!token || room?.status !== 'waiting') return;
    const entry = `${code}:${selfId}`;
    if (avatarEntry.current === entry) return;
    avatarEntry.current = entry;
    // The server chooses within its locked room update to avoid races.
    perform('set-avatar');
  }, [code, selfId, token, room?.status]);

  function updateRoom(updated: Rush10RoomView) {
    queryClient.setQueryData(roomKey, updated);
    setNotice('');
  }

  const perform: Perform = (action, extra = {}, onDone, onError) => {
    if (!token) { onError?.(); return; }
    setNotice('');
    void queryClient.cancelQueries({ queryKey: roomKey });
    act.mutate({ code, data: { playerToken: token, action, ...extra } as Rush10PlayerAction }, {
      onSuccess: (updated) => { updateRoom(updated); onDone?.(updated); },
      onError: (reason) => { setNotice(errorMessage(reason, 'That move could not be played. Try again.')); onError?.(); },
    });
  };

  function start() {
    if (!token) return;
    setNotice('');
    void queryClient.cancelQueries({ queryKey: roomKey });
    startGame.mutate({ code, data: { playerToken: token } }, {
      onSuccess: updateRoom,
      onError: (reason) => setNotice(errorMessage(reason, 'Could not start the game.')),
    });
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(`Game code: ${code}`);
    }
  }

  useEffect(() => {
    if (!editingName && self) setNameDraft(self.name);
  }, [editingName, self?.name]);
  useEffect(() => () => window.clearTimeout(nameTimer.current), [room?.status]);

  function commitName(draft: string) {
    window.clearTimeout(nameTimer.current);
    const name = draft.trim();
    if (!name || name === self?.name || room?.status !== 'waiting') return;
    saveLastName(name);
    perform('set-name', { playerName: name });
  }

  function editName(draft: string) {
    setNameDraft(draft);
    // Save shortly after typing pauses so others see the change without waiting for blur.
    window.clearTimeout(nameTimer.current);
    nameTimer.current = window.setTimeout(() => commitName(draft), 600);
  }

  function pickAvatar(avatar: AvatarKind) {
    if (avatar === normalizeAvatar(self?.avatar)) {
      setAvatarPulse(pulse => pulse + 1);
      return;
    }
    perform('set-avatar', { avatar }, () => setAvatarPulse(pulse => pulse + 1));
  }

  if (!token) return (
    <main className="page-shell" style={{ '--paper': '#111827' } as CSSProperties}>
      <div className="page-content mx-auto max-w-xl px-5 py-16">
        <div className="mb-8"><BackHome onClick={() => go('/', { back: true })} /></div>
        <div className="rounded-[26px] border-2 border-white/10 bg-[#1E293B] p-7 shadow-[var(--shadow-card)]">
          <p className="font-mono text-xs uppercase tracking-[.18em] text-[#94A3B8]">Game {code}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.06em]">You’ll need your seat token.</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#94A3B8]">This browser doesn’t have a saved player session for this game. Rejoin from the home page, or return on the device where you started.</p>
          <button onClick={() => go('/')} className="mt-6 rounded-xl bg-[#FF3366] px-5 py-3 font-bold text-white">Go to the lobby <ArrowRight className="ml-2 inline" size={16} /></button>
        </div>
      </div>
    </main>
  );

  if (roomQuery.isError) return (
    <main className="page-shell" style={{ '--paper': '#111827' } as CSSProperties}>
      <div className="page-content mx-auto max-w-xl px-5 py-20 text-center">
        <div className="rounded-[26px] border-2 border-white/10 bg-[#1E293B] p-8 shadow-[var(--shadow-card)]"><h1 className="text-3xl font-bold">Can't find your game</h1><p className="mt-3 text-[#94A3B8]">The game may have closed, or this seat needs reconnecting.</p><button onClick={() => roomQuery.refetch()} className="mt-5 rounded-xl bg-[#FF3366] px-5 py-3 font-bold text-white"><RefreshCw className="mr-2 inline" size={16} /> Try again</button></div>
      </div>
    </main>
  );

  if (roomQuery.isLoading || !room) return (
    <main className="page-shell" style={{ '--paper': '#111827' } as CSSProperties}>
      <div className="page-content flex min-h-[100dvh] flex-col items-center justify-between px-5 py-8">
        <div className="flex w-full justify-around">{[0, 1, 2].map(i => <div key={i} className="flex flex-col items-center gap-2"><div className="h-9 w-9 animate-pulse rounded-full bg-[#1E293B]" /><div className="h-3 w-20 animate-pulse rounded bg-[#1E293B]" /></div>)}</div>
        <div className="flex gap-10"><div className="h-[135px] w-[88px] animate-pulse rounded-[14px] bg-[#1E293B]" /><div className="h-[135px] w-[88px] animate-pulse rounded-[14px] bg-[#1E293B]" /></div>
        <div className="flex">{Array.from({ length: 10 }, (_, i) => <div key={i} className="-ml-8 h-[150px] w-[100px] animate-pulse rounded-[16px] border-2 border-[#111827] bg-[#1E293B]" style={{ transform: `rotate(${(i - 4.5) * 3}deg)` }} />)}</div>
      </div>
    </main>
  );

  const bannerEl = banner && <div role="status" data-testid="game-notification" className="pop-in fixed left-1/2 top-3 z-[95] flex max-w-[min(560px,92vw)] -translate-x-1/2 items-center gap-3 rounded-full bg-[#1E293B] py-2 pl-4 pr-2 text-sm font-medium text-white shadow-[0_12px_30px_rgba(0,0,0,.45)] ring-1 ring-[#FFB800]/50">
    <span>{banner}</span>
    <button onClick={() => { setNotice(''); setDismissedMessage(room.message); }} data-testid="dismiss-game-notification" aria-label="Dismiss notification" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-white/10"><X size={14} /></button>
  </div>;

  if (room.status !== 'waiting' && !leavingLobby) return (
    <main className="page-shell" style={{ '--paper': '#111827' } as CSSProperties}>
      {((room.status !== 'round-over' && room.status !== 'finished') || notice) && bannerEl}
      <div className="page-content">
        <GameTable room={room} code={code} selfId={selfId} rules={rulesQuery.data} rulesLoading={rulesQuery.isLoading} retryRules={() => rulesQuery.refetch()}
          perform={perform} start={start} isBusy={isBusy} actPending={act.isPending} startPending={startGame.isPending} onExit={() => go('/')}
          dealDelay={phase === 'enter' ? 0.3 : 0} />
      </div>
    </main>
  );

  const myAvatar = normalizeAvatar(self?.avatar);
  const isHost = room.hostPlayerId === self?.id;
  const takenBy: Partial<Record<AvatarKind, string>> = {};
  room.players.forEach(p => { if (p.id !== selfId) takenBy[normalizeAvatar(p.avatar)] = p.name; });

  return (
    <main className="page-shell waiting-page" style={{ '--paper': '#111827' } as CSSProperties}>
      <LobbyCardBackdrop />
      {notice && bannerEl}
      <div className="page-content mx-auto max-w-[1400px] px-4 pb-12 pt-4 md:px-8 md:pt-6">
        <div className="mx-auto w-fit max-w-full">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3 pb-4">
            <BackHome onClick={() => go('/', { back: true })} />
          </header>
          <section className="w-[598px] max-w-full py-5 md:py-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-4xl font-bold tracking-[-.07em]">Invite players to join</h1>
              <button onClick={copyCode} aria-label={copied ? 'Game code copied' : 'Copy game code'} className="flex items-center gap-2 rounded-xl bg-[#4F46E5] px-4 py-3 font-mono text-sm font-bold tracking-[.14em] text-white hover:bg-[#6366F1]">Game code: {code}{copied ? <Check size={16} /> : <Clipboard size={16} />}</button>
            </div>
            {self && <label className="mt-7 block">
              <span className="mb-3 block text-xs font-bold tracking-[.12em] text-[#94A3B8]">your name</span>
              <input value={nameDraft} onChange={(e) => editName(e.target.value)} onFocus={() => setEditingName(true)}
                onBlur={() => { commitName(nameDraft); setEditingName(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                maxLength={20} data-testid="input-edit-name" className="h-12 w-full rounded-xl border border-[#334155] bg-[#0F172A] px-4 text-[15px] outline-none transition focus:border-[#FF3366] focus:ring-2 focus:ring-[#FF3366]/15" />
            </label>}
            {self && <div className="mt-7">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <p className="text-xs font-bold tracking-[.12em] text-[#94A3B8]">pick your avatar</p>
              </div>
              <AvatarPicker value={myAvatar} onPick={pickAvatar} disabled={act.isPending} takenBy={takenBy} />
            </div>}
            <div className="mt-8 grid gap-3">
              <h2 className="text-xl font-bold text-white">Players:</h2>
              {room.players.map((player) => <PlayerTile key={player.id} player={player.id === self?.id && nameDraft.trim() ? { ...player, name: nameDraft.trim() } : player} self={player.id === self?.id} avatarPulse={player.id === self?.id ? avatarPulse : 0} unboxed
                onRemove={isHost && player.isBot ? () => perform('remove-bot', { targetPlayerId: player.id }) : undefined}
                onBotLevel={isHost && player.isBot ? botLevel => perform('set-bot-level', { targetPlayerId: player.id, botLevel }) : undefined} />)}
              {room.players.length < 6 && <div className="flex flex-col items-start gap-3 px-3 text-sm font-semibold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">
                <span className="flex min-h-[74px] items-center gap-3"><span className="flex h-10 w-10 items-center justify-center"><Users size={16} /></span>Waiting for a player...</span>
                {isHost && <button type="button" onClick={() => perform('add-bot')} disabled={isBusy} data-testid="button-add-bot" className="flex items-center gap-2 rounded-xl border border-[#334155] bg-[#0F172A] px-4 py-2.5 font-bold text-white transition enabled:hover:border-[#A3E635] disabled:opacity-60"><Bot size={16} className="text-[#A3E635]" /> Add a bot player</button>}
              </div>}
            </div>
            <div className="mt-8 flex flex-col items-center gap-4 py-4 text-center">
              {room.hostPlayerId === self?.id ? <button onClick={start} disabled={isBusy || room.players.length < 2} data-testid="button-start-game" className={`flex items-center justify-center gap-2 rounded-xl border-2 px-6 py-3 font-bold opacity-100 shadow-[0_8px_24px_rgba(0,0,0,.8),0_0_0_3px_rgba(17,24,39,.9)] transition enabled:hover:translate-y-[-1px] disabled:opacity-100 ${room.players.length < 2 ? 'cursor-default! border-[#64748B] bg-[#475569] text-[#CBD5E1]' : 'border-white bg-[#FF3366] text-white disabled:cursor-not-allowed'}`}>{startGame.isPending ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowRight size={17} />} Start game</button> : <div className="flex items-center gap-2 text-xs font-semibold text-[#94A3B8]"><LoaderCircle size={15} className="animate-spin" /> Waiting for the host to deal</div>}
              {room.players.length < 2 && <div><p className="text-sm font-bold">Need at least one more player</p><p className="mt-1 text-xs text-[#94A3B8]">Rush 10 is for 2–6 players.</p></div>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <PageTransitionProvider>
            <AppRouter />
          </PageTransitionProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
