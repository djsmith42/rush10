/** Require sustained poor performance, not one slow frame during page load. */
export function createBackgroundFrameMonitor() {
  let started: number | undefined;
  let frames = 0;
  let slowWindows = 0;
  return {
    reset() { started = undefined; frames = 0; slowWindows = 0; },
    sample(now: number) {
      if (started === undefined) { started = now; return false; }
      frames++;
      const elapsed = now - started;
      if (elapsed < 2000) return false;
      slowWindows = frames * 1000 / elapsed < 40 ? slowWindows + 1 : 0;
      started = now;
      frames = 0;
      return slowWindows >= 2;
    },
  };
}
