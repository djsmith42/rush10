import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Router, useLocation, useRouter } from 'wouter';
import { useBrowserLocation } from 'wouter/use-browser-location';

/** idle → fade-out (foreground) → fall (backdrop cards) → swap → enter (cards fall in, settle behind blur, then foreground). */
export type TransitionPhase = 'idle' | 'fade-out' | 'fall' | 'enter';
/** Back plays the same transition in reverse: cards rise away, and the next ones rise in from below. */
export type TransitionDirection = 'forward' | 'back';

// Keep in step with the route-stage rules and backdrop keyframes in index.css.
const FADE_OUT_MS = 300;
const FALL_MS = 900;
const ENTER_MS = 1500;
/** A first load holds on the bare background this long, then plays the entrance this many times slower. */
const FIRST_LOAD = { holdMs: 500, slowdown: 2 };
type Entrance = typeof FIRST_LOAD;
const NORMAL: Entrance = { holdMs: 0, slowdown: 1 };

type PageTransition = {
  phase: TransitionPhase;
  /** Play the exit, run `swap` to show what comes next, then play the entrance. */
  leave: (swap: () => void, options?: { back?: boolean }) => void;
  go: (path: string, options?: { replace?: boolean; back?: boolean }) => void;
};

const Context = createContext<PageTransition | null>(null);

// The routes render this location, which can lag the address bar while a browser back plays its exit.
type ShownLocation = ReturnType<typeof useBrowserLocation>;
const ShownLocationContext = createContext<ShownLocation | null>(null);
const useShownLocation = () => useContext(ShownLocationContext)!;

export function PageTransitionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<TransitionPhase>('idle');
  const [direction, setDirection] = useState<TransitionDirection>('forward');
  const [entrance, setEntrance] = useState(NORMAL);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const timers = useRef<number[]>([]);
  const { base } = useRouter();
  const [, navigate] = useLocation();
  const [browserPath, browserNavigate] = useBrowserLocation();
  const [heldPath, setHeldPath] = useState<string | null>(null);
  const shownPath = heldPath ?? browserPath;
  const shownPathRef = useRef(shownPath);
  shownPathRef.current = shownPath;
  const shownLocation = useMemo<ShownLocation>(() => [shownPath, browserNavigate], [shownPath, browserNavigate]);

  const clearTimers = () => { timers.current.forEach(window.clearTimeout); timers.current = []; };
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  const enter = useCallback((next: Entrance = NORMAL) => {
    clearTimers();
    setEntrance(next);
    setPhase('enter');
    later(next.holdMs + ENTER_MS * next.slowdown, () => setPhase('idle'));
  }, []);

  const leave = useCallback((swap: () => void, options?: { back?: boolean }) => {
    if (phaseRef.current === 'fade-out' || phaseRef.current === 'fall') return;
    clearTimers();
    setDirection(options?.back ? 'back' : 'forward');
    setPhase('fade-out');
    later(FADE_OUT_MS, () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const hasBackdrop = !!document.querySelector('.lobby-backdrop');
      const finish = () => {
        // One commit for the new screen and its entrance, so it never paints mid-exit.
        flushSync(() => { swap(); setEntrance(NORMAL); setPhase('enter'); });
        later(ENTER_MS, () => setPhase('idle'));
      };
      if (reduce || !hasBackdrop) { finish(); return; }
      setPhase('fall');
      later(FALL_MS, finish);
    });
  }, []);

  const go = useCallback((path: string, options?: { replace?: boolean; back?: boolean }) =>
    leave(() => navigate(path, { replace: options?.replace }), { back: options?.back }), [leave, navigate]);

  // Browser back/forward: hold the old screen on view, play the reversed exit, then show the new one.
  // Capture phase runs this before wouter's own popstate listener, so the new route never paints early.
  useEffect(() => {
    const onPopState = () => {
      if (phaseRef.current === 'fade-out' || phaseRef.current === 'fall') return;
      setHeldPath(shownPathRef.current);
      leave(() => setHeldPath(null), { back: true });
    };
    window.addEventListener('popstate', onPopState, true);
    return () => window.removeEventListener('popstate', onPopState, true);
  }, [leave]);

  // A first load onto a card backdrop starts on the bare background and plays the entrance.
  // Layout effect, so the resting pile never paints before the cards fall in.
  useLayoutEffect(() => {
    if (document.querySelector('.lobby-backdrop')) enter(FIRST_LOAD);
  }, [enter]);

  // Redirects skip the exit, but still get the entrance.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    if (phaseRef.current === 'idle') enter();
  }, [shownPath, enter]);

  useEffect(() => clearTimers, []);

  const value = useMemo(() => ({ phase, leave, go }), [phase, leave, go]);
  return (
    <Context.Provider value={value}>
      <ShownLocationContext.Provider value={shownLocation}>
        <Router hook={useShownLocation} base={base}>
          <div className="route-stage" data-transition={phase} data-direction={direction} style={{ '--enter-hold': `${entrance.holdMs}ms`, '--enter-slowdown': entrance.slowdown } as CSSProperties}>{children}</div>
        </Router>
      </ShownLocationContext.Provider>
    </Context.Provider>
  );
}

export function usePageTransition() {
  const value = useContext(Context);
  if (!value) throw new Error('usePageTransition needs a PageTransitionProvider.');
  return value;
}
