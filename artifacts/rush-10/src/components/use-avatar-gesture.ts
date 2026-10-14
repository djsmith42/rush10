import { useEffect, useRef } from 'react';

/** Animate SVG features, never the avatar wrapper used by hover/click feedback. */
export function useAvatarGesture(kind: string) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let animation: Animation | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden || motion.matches) return;
      timer = setTimeout(() => {
        const svg = ref.current;
        // Let deliberate interactions take priority over idle gestures.
        if (svg && !svg.closest('button:hover, button:focus-visible')) {
          const feature = svg.querySelector<SVGElement>('[data-idle-feature]');
          const face = svg.querySelector<SVGElement>('[data-idle-face]');
          const target = feature ?? face;
          if (target) {
            const gesture = feature?.dataset.idleFeature;
            const transforms = gesture === 'ear-flop'
              ? ['rotate(0deg)', 'rotate(-80deg)', 'rotate(-80deg)', 'rotate(6deg)', 'rotate(0deg)']
              : gesture === 'wink' || gesture === 'blink'
              ? ['scaleY(1)', `scaleY(${gesture === 'blink' ? '.06' : '.12'})`, `scaleY(${gesture === 'blink' ? '.06' : '.12'})`, 'scaleY(1)']
              : gesture === 'mouth'
                ? ['scaleY(.18)', 'scaleY(1)', 'scaleY(1)', 'scaleY(.18)']
              : gesture === 'sniff'
                ? ['scale(1)', 'scale(1.25)', 'scale(1.08)', 'scale(1)']
                : gesture === 'smile'
                  ? ['scaleX(1)', 'scaleX(1.6)', 'scaleX(1.6)', 'scaleX(1)']
                  : ['translateY(0) rotate(0deg)', 'translateY(1px) rotate(3deg)', 'translateY(.5px) rotate(-1deg)', 'translateY(0) rotate(0deg)'];
            animation = target.animate(transforms.map(transform => ({ transform })), {
              duration: gesture === 'wink' || gesture === 'blink' ? 650 : 950,
              easing: 'ease-in-out',
            });
          }
        }
        schedule();
      }, (5_000 + Math.random() * 5_000) / 3);
    };
    const reset = () => { animation?.cancel(); schedule(); };
    schedule();
    document.addEventListener('visibilitychange', reset);
    motion.addEventListener('change', reset);
    return () => {
      clearTimeout(timer);
      animation?.cancel();
      document.removeEventListener('visibilitychange', reset);
      motion.removeEventListener('change', reset);
    };
  }, [kind]);
  return ref;
}
