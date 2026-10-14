import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Rush10RoomView } from '@workspace/api-client-react';

/** Announce newly observed events, never replay historical Skips on reconnect. */
export function SkipSplash({ room }: { room: Rush10RoomView }) {
  const seen = useRef(new Set((room.events ?? []).map(event => event.id)));
  const [announcement, setAnnouncement] = useState<{ id: string; text: string } | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const fresh = (room.events ?? []).filter(event => !seen.current.has(event.id));
    for (const event of room.events ?? []) seen.current.add(event.id);
    const skip = fresh.filter(event => event.kind === 'discard' && event.card?.type === 'skip' && event.targetPlayerId).at(-1);
    if (!skip) return;
    const player = room.players.find(player => player.id === skip.playerId);
    const target = room.players.find(player => player.id === skip.targetPlayerId);
    if (player && target) setAnnouncement({ id: skip.id, text: `${player.name} skipped ${target.name}!` });
  }, [room.events, room.players]);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(null), 2000);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  if (!announcement) return null;
  return <div className="pointer-events-none fixed inset-0 z-[150] flex -translate-y-[20vh] items-center justify-center px-5" role="status" aria-live="polite" data-testid="skip-announcement">
    <motion.div key={announcement.id}
      initial={reduce ? false : { opacity: 0, scale: 1.35, rotate: -3 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ duration: .3, ease: [.22, 1, .36, 1] }}
      className="max-w-[min(850px,92vw)] rounded-[32px] border-4 border-[#FFB800] bg-[#111827]/95 px-8 py-10 text-center shadow-[0_20px_100px_rgba(0,0,0,.8),0_0_70px_rgba(255,184,0,.25)]">
      <p className="mb-3 text-xl font-black uppercase tracking-[.3em] text-[#FFB800]">Skipped!</p>
      <p className="break-words text-[clamp(2rem,5vw,4.5rem)] font-black leading-tight text-white">{announcement.text}</p>
    </motion.div>
  </div>;
}
