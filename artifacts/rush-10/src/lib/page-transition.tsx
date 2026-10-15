import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useLocation } from 'wouter';

/** idle → fade-out (foreground) → fall (backdrop cards) → swap → enter (cards fly in, then foreground). */
export type TransitionPhase = 'idle' | 'fade-out' | 'fall' | 'enter';

// Keep in step with the route-stage rules and backdrop keyframes in index.css.
const FADE_OUT_MS = 300;
const FALL_MS = 900;
const ENTER_MS = 1200;

type PageTransition = {
  phase: TransitionPhase;
  /** Play the exit, run `swap` to show what comes next, then play the entrance. */
  leave: (swap: () => void) => void;
  go: (path: string, options?: { replace?: boolean }) => void;
};

const Context = createContext<PageTransition | null>(null);

export function PageTransitionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<TransitionPhase>('idle');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const timers = useRef<number[]>([]);
  const [location, navigate] = useLocation();

  const clearTimers = () => { timers.current.forEach(window.clearTimeout); timers.current = []; };
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  const enter = useCallback(() => {
    clearTimers();
    setPhase('enter');
    later(ENTER_MS, () => setPhase('idle'));
  }, []);

  const leave = useCallback((swap: () => void) => {
    if (phaseRef.current === 'fade-out' || phaseRef.current === 'fall') return;
    clearTimers();
    setPhase('fade-out');
    later(FADE_OUT_MS, () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const hasBackdrop = !!document.querySelector('.lobby-backdrop');
      const finish = () => {
        // One commit for the new screen and its entrance, so it never paints mid-exit.
        flushSync(() => { swap(); setPhase('enter'); });
        later(ENTER_MS, () => setPhase('idle'));
      };
      if (reduce || !hasBackdrop) { finish(); return; }
      setPhase('fall');
      later(FALL_MS, finish);
    });
  }, []);

  const go = useCallback((path: string, options?: { replace?: boolean }) => leave(() => navigate(path, options)), [leave, navigate]);

  // Back/forward and redirects skip the exit, but still get the entrance.
  const firstLocation = useRef(true);
  useEffect(() => {
    if (firstLocation.current) { firstLocation.current = false; return; }
    if (phaseRef.current === 'idle') enter();
  }, [location, enter]);

  useEffect(() => clearTimers, []);

  const value = useMemo(() => ({ phase, leave, go }), [phase, leave, go]);
  return (
    <Context.Provider value={value}>
      <div className="route-stage" data-transition={phase}>{children}</div>
    </Context.Provider>
  );
}

export function usePageTransition() {
  const value = useContext(Context);
  if (!value) throw new Error('usePageTransition needs a PageTransitionProvider.');
  return value;
}
