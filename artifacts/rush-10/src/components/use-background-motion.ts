import { useEffect, useState } from 'react';
import { createBackgroundFrameMonitor } from '@/lib/background-frame-rate';

const STORAGE_KEY = 'rush10-static-background';
let slowDevice = false;

/** True once this device has shown it cannot keep the background moving smoothly. */
export function rememberedSlowDevice() {
  try { slowDevice ||= sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { /* Storage may be blocked. */ }
  return slowDevice;
}

/** Actual rendering performance is more useful than guessing from device names. */
export function useBackgroundMotion() {
  const [paused, setPaused] = useState(() =>
    rememberedSlowDevice() || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const monitor = createBackgroundFrameMonitor();
    let frame = 0;
    let warmUntil = 0;

    function sample(now: number) {
      if (now >= warmUntil && monitor.sample(now)) {
        slowDevice = true;
        try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch { /* In-memory fallback remains active. */ }
        setPaused(true);
        return;
      }
      frame = requestAnimationFrame(sample);
    }

    function sync() {
      cancelAnimationFrame(frame);
      monitor.reset();
      const stop = slowDevice || document.hidden || reducedMotion.matches;
      setPaused(stop);
      if (!stop) {
        // Ignore initial mounting, tab activation, and resizing work.
        warmUntil = performance.now() + 1500;
        frame = requestAnimationFrame(sample);
      }
    }

    sync();
    document.addEventListener('visibilitychange', sync);
    reducedMotion.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);
  return !paused;
}
