import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useAvatarGesture } from '@/components/use-avatar-gesture';

export const AVATARS = ['fox', 'cat', 'bear', 'rabbit', 'owl', 'panda', 'frog', 'penguin'] as const;
export type AvatarKind = typeof AVATARS[number];
export const AVATAR_NAMES: Record<AvatarKind, string> = {
  fox: 'Fox', cat: 'Cat', bear: 'Bear', rabbit: 'Rabbit', owl: 'Owl', panda: 'Panda', frog: 'Frog', penguin: 'Penguin',
};
const BG: Record<AvatarKind, string> = {
  fox: '#2979FF', cat: '#8B5CF6', bear: '#00C896', rabbit: '#FF3366', owl: '#4F46E5', panda: '#A3E635', frog: '#EC4899', penguin: '#FFB800',
};
const INK = '#111827';

function eyes(y: number, gap = 7, r = 2.3) {
  return <><circle cx={32 - gap} cy={y} r={r} fill={INK} />
    <circle cx={32 - gap + 0.8} cy={y - 0.8} r={0.7} fill="#fff" />
    <g data-idle-feature="wink"><circle cx={32 + gap} cy={y} r={r} fill={INK} /><circle cx={32 + gap + 0.8} cy={y - 0.8} r={0.7} fill="#fff" /></g></>;
}

const ART: Record<AvatarKind, ReactNode> = {
  fox: <>
    <path d="M13 12 L27 23 L17 33Z" fill="#FF6B35" /><path d="M51 12 L37 23 L47 33Z" fill="#FF6B35" />
    <path d="M16 16 L23 22 L18 27Z" fill="#7C2D12" /><path d="M48 16 L41 22 L46 27Z" fill="#7C2D12" />
    <path d="M11 29 Q32 13 53 29 Q47 49 32 54 Q17 49 11 29Z" fill="#FF6B35" />
    <path d="M14 34 Q26 37 32 54 Q19 50 14 34Z" fill="#F8FAFC" /><path d="M50 34 Q38 37 32 54 Q45 50 50 34Z" fill="#F8FAFC" />
    {eyes(33)}<ellipse cx="32" cy="49" rx="3" ry="2.2" fill={INK} />
  </>,
  cat: <>
    <path d="M15 14 L27 24 L15 31Z" fill="#FDE68A" /><path d="M49 14 L37 24 L49 31Z" fill="#FDE68A" />
    <path d="M17 18 L23 23 L17 27Z" fill="#FB7185" /><path d="M47 18 L41 23 L47 27Z" fill="#FB7185" />
    <circle cx="32" cy="37" r="18" fill="#FDE68A" />
    <path d="M26 21 Q32 26 38 21" stroke="#F59E0B" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    <ellipse cx="25" cy="35" rx="2.6" ry="3.4" fill="#16A34A" /><ellipse cx="39" cy="35" rx="2.6" ry="3.4" fill="#16A34A" />
    <ellipse cx="25" cy="35" rx="0.9" ry="2.8" fill={INK} /><ellipse cx="39" cy="35" rx="0.9" ry="2.8" fill={INK} />
    <path d="M30 42 L34 42 L32 44.5Z" fill="#FB7185" />
    <path data-idle-feature="smile" d="M32 44.5 Q29 48 26.5 46 M32 44.5 Q35 48 37.5 46" stroke={INK} strokeWidth="1.3" fill="none" strokeLinecap="round" />
    <path d="M10 40 L22 42 M10 45 L22 44 M54 40 L42 42 M54 45 L42 44" stroke="#F8FAFC" strokeWidth="1.1" strokeLinecap="round" />
  </>,
  bear: <>
    <circle cx="17" cy="20" r="8" fill="#92400E" /><circle cx="47" cy="20" r="8" fill="#92400E" />
    <circle cx="17" cy="20" r="4" fill="#FDBA74" /><circle cx="47" cy="20" r="4" fill="#FDBA74" />
    <circle cx="32" cy="36" r="19" fill="#B45309" />
    <ellipse cx="32" cy="44" rx="9" ry="7" fill="#FED7AA" />
    {eyes(33, 7.5)}<ellipse cx="32" cy="41.5" rx="3.4" ry="2.4" fill={INK} />
    <path d="M32 44 L32 47 M29 48 Q32 50 35 48" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </>,
  rabbit: <>
    <ellipse cx="24" cy="17" rx="5.5" ry="14" fill="#F8FAFC" transform="rotate(-10 24 17)" />
    <ellipse cx="24" cy="18" rx="2.6" ry="10" fill="#FDA4AF" transform="rotate(-10 24 18)" />
    <g data-idle-feature="ear-flop" style={{ transformBox: 'view-box', transformOrigin: '40px 30px' }}>
      <ellipse cx="40" cy="17" rx="5.5" ry="14" fill="#F8FAFC" transform="rotate(10 40 17)" />
      <ellipse cx="40" cy="18" rx="2.6" ry="10" fill="#FDA4AF" transform="rotate(10 40 18)" />
    </g>
    <circle cx="32" cy="41" r="16" fill="#F8FAFC" />
    {eyes(38, 6.5)}<circle cx="22" cy="45" r="2.8" fill="#FDA4AF" opacity=".8" /><circle cx="42" cy="45" r="2.8" fill="#FDA4AF" opacity=".8" />
    <path d="M30 43 L34 43 L32 45.5Z" fill="#FB7185" /><rect x="30.3" y="46" width="3.4" height="4" rx="1" fill="#fff" stroke="#CBD5E1" strokeWidth=".6" />
  </>,
  owl: <>
    <path d="M15 17 L23 25 L15 28Z" fill="#78350F" /><path d="M49 17 L41 25 L49 28Z" fill="#78350F" />
    <ellipse cx="32" cy="38" rx="19" ry="18" fill="#B45309" />
    <path d="M20 47 Q32 58 44 47 Q32 52 20 47Z" fill="#FCD34D" opacity=".55" />
    <circle cx="24" cy="34" r="8" fill="#F8FAFC" /><circle cx="40" cy="34" r="8" fill="#F8FAFC" />
    <circle cx="24" cy="34" r="4.2" fill="#FFB800" /><circle cx="40" cy="34" r="4.2" fill="#FFB800" />
    <circle cx="24" cy="34" r="2.3" fill={INK} /><circle cx="40" cy="34" r="2.3" fill={INK} />
    <path d="M29 40 L35 40 L32 46Z" fill="#FF6B35" />
  </>,
  panda: <>
    <circle cx="17" cy="19" r="7.5" fill={INK} /><circle cx="47" cy="19" r="7.5" fill={INK} />
    <circle cx="32" cy="36" r="19" fill="#F8FAFC" />
    <ellipse cx="24" cy="34" rx="5" ry="6.5" fill={INK} transform="rotate(25 24 34)" /><ellipse cx="40" cy="34" rx="5" ry="6.5" fill={INK} transform="rotate(-25 40 34)" />
    <circle cx="24.5" cy="33.5" r="1.9" fill="#fff" /><circle cx="39.5" cy="33.5" r="1.9" fill="#fff" />
    <ellipse cx="32" cy="42" rx="3.2" ry="2.2" fill={INK} />
    <ellipse data-idle-feature="mouth" cx="32" cy="47.5" rx="3.5" ry="3.5" fill={INK} style={{ transform: 'scaleY(.18)' }} />
  </>,
  frog: <>
    <circle cx="21" cy="22" r="8" fill="#00C896" /><circle cx="43" cy="22" r="8" fill="#00C896" />
    <g data-idle-feature="blink">
      <circle cx="21" cy="22" r="5" fill="#F8FAFC" /><circle cx="43" cy="22" r="5" fill="#F8FAFC" />
      <circle cx="21.6" cy="22.6" r="2.6" fill={INK} /><circle cx="43.6" cy="22.6" r="2.6" fill={INK} />
    </g>
    <ellipse cx="32" cy="39" rx="21" ry="15" fill="#00C896" />
    <path d="M18 40 Q32 51 46 40" stroke="#065F46" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    <circle cx="17" cy="35" r="3" fill="#FB7185" opacity=".7" /><circle cx="47" cy="35" r="3" fill="#FB7185" opacity=".7" />
    <g><circle cx="29" cy="34" r=".9" fill="#065F46" /><circle cx="35" cy="34" r=".9" fill="#065F46" /></g>
  </>,
  penguin: <>
    <circle cx="32" cy="35" r="20" fill="#1E293B" />
    <path d="M32 26 Q38 19 44 25 Q49 33 45 43 Q40 53 32 53 Q24 53 19 43 Q15 33 20 25 Q26 19 32 26Z" fill="#F8FAFC" />
    {eyes(34, 6.5)}<path d="M27.5 40 L36.5 40 L32 45.5Z" fill="#FF6B35" />
    <circle cx="22" cy="42" r="2.4" fill="#FDA4AF" opacity=".75" /><circle cx="42" cy="42" r="2.4" fill="#FDA4AF" opacity=".75" />
  </>,
};

export function normalizeAvatar(avatar: string | undefined | null): AvatarKind {
  return (AVATARS as readonly string[]).includes(avatar ?? '') ? avatar as AvatarKind : 'fox';
}

export function AnimalAvatar({ kind, size = 44, className = '', decorative = false }: { kind?: string | null; size?: number; className?: string; decorative?: boolean }) {
  const k = normalizeAvatar(kind);
  const gestureRef = useAvatarGesture(k);
  return <svg ref={gestureRef} viewBox="0 0 64 64" width={size} height={size} className={`animal-avatar shrink-0 ${className}`}
    role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `${AVATAR_NAMES[k]} avatar`}>
    {!decorative && <title>{AVATAR_NAMES[k]}</title>}
    <circle cx="32" cy="32" r="32" fill={BG[k]} />
    <circle cx="32" cy="32" r="32" fill="url(#avatar-sheen)" />
    <defs><radialGradient id="avatar-sheen" cx=".3" cy=".25" r=".8"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".6" stopColor="#fff" stopOpacity="0" /></radialGradient></defs>
    <g data-idle-face>{ART[k]}</g>
  </svg>;
}

export function AvatarPicker({ value, onPick, disabled, takenBy }: { value: AvatarKind; onPick: (kind: AvatarKind) => void; disabled?: boolean; takenBy?: Partial<Record<AvatarKind, string>> }) {
  const [clicked, setClicked] = useState<AvatarKind | null>(null);
  return <div role="radiogroup" aria-label="Choose your avatar" className="flex flex-wrap gap-2.5" data-testid="avatar-picker">
    {AVATARS.map((kind) => {
      const active = kind === value;
      return <button key={kind} type="button" role="radio" aria-checked={active} disabled={disabled || !!takenBy?.[kind]}
        onPointerLeave={() => setClicked(current => current === kind ? null : current)}
        onBlur={() => setClicked(current => current === kind ? null : current)}
        onClick={(event) => {
          setClicked(kind);
          const coin = event.currentTarget.querySelector<HTMLElement>('.avatar-coin');
          if (coin) {
            coin.getAnimations().forEach(animation => animation.cancel());
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
              coin.animate([
                { transform: 'scale(1.4)' },
                { transform: 'scale(1.7)', offset: 0.4 },
                { transform: 'scale(1)' },
              ], { duration: 400, easing: 'ease-in-out' });
            }
          }
          onPick(kind);
        }} data-testid={`button-avatar-${kind}`}
        title={takenBy?.[kind] ? `${AVATAR_NAMES[kind]} (taken by ${takenBy[kind]})` : AVATAR_NAMES[kind]}
        className={`avatar-choice group relative flex flex-col items-center gap-1 rounded-2xl p-1.5 disabled:cursor-not-allowed ${takenBy?.[kind] ? 'opacity-40' : ''} ${active ? 'is-active' : ''} ${clicked === kind ? 'is-clicked' : ''}`}>
        <span className="avatar-coin relative block">
          <AnimalAvatar kind={kind} size={54} decorative />
          {active && <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#1E293B] bg-[#A3E635] text-[#111827]"><Check size={11} strokeWidth={3} /></span>}
        </span>
        <span className={`text-[10px] font-bold ${active ? 'text-[#A3E635]' : 'text-[#94A3B8]'}`}>{AVATAR_NAMES[kind]}</span>
      </button>;
    })}
  </div>;
}
