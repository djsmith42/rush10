import { useEffect, useRef, useState } from 'react';
import type { Rush10BotLevel, Rush10Player, Rush10Rules } from '@workspace/api-client-react';
import { Bot, Check, ChevronDown, CircleHelp, Crown, RefreshCw, X } from 'lucide-react';
import { AnimalAvatar } from '@/components/avatars';

export function PlayerTile({ player, self, active = false, playing = false, unboxed = false, avatarPulse = 0, onRemove, onBotLevel }: { player: Rush10Player; self: boolean; active?: boolean; playing?: boolean; unboxed?: boolean; avatarPulse?: number; onRemove?: () => void; onBotLevel?: (level: Rush10BotLevel) => void }) {
  const avatarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!avatarPulse || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = avatarRef.current?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.4)' }, { transform: 'scale(1)' }],
      { duration: 500, easing: 'ease-in-out' },
    );
    return () => animation?.cancel();
  }, [avatarPulse]);
  return <div className={`flex items-center gap-3 px-3 py-3 ${unboxed ? '' : `rounded-2xl border ${playing && player.hasLaidPhase ? 'level-complete' : ''} ${active ? 'border-[#A3E635] bg-[#A3E635]/10' : 'border-[#334155] bg-[#0F172A]'}`}`} data-testid={`player-row-${player.id}`}>
    <div ref={avatarRef} className="relative shrink-0">
      <AnimalAvatar kind={player.avatar} size={unboxed ? 80 : 44} />
      {player.isHost && <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#1E293B] bg-[#FFB800] text-[#111827]" aria-label="Host"><Crown size={11} /></span>}
    </div>
    <div className={`min-w-0 flex-1 ${unboxed ? 'pl-3' : ''}`}><div className="flex items-center gap-1.5"><p className={`truncate font-bold ${unboxed ? 'text-[31.5px] leading-tight text-white' : 'text-sm'}`}>{player.name}{self && <span className="ml-1.5 text-[10px] font-medium text-[#94A3B8]">(you)</span>}</p>{player.isBot && <Bot size={unboxed ? 22 : 12} className="shrink-0 text-[#94A3B8]" aria-label="Bot" />}{active && <span className="h-1.5 w-1.5 rounded-full bg-[#A3E635]" />}</div>
      {!playing && onBotLevel ? <BotLevelPicker name={player.name} value={player.botLevel ?? 'medium'} onPick={onBotLevel} />
        : <p className="mt-0.5 text-[10px] text-[#94A3B8]">{playing && player.hasLaidPhase && <Check size={10} className="mr-1 inline text-[#A3E635]" aria-label="Level laid" />}{playing ? `Level ${player.phase} · ${player.handCount} cards` : player.isHost ? 'Host' : player.isBot ? `${BOT_LEVELS[player.botLevel ?? 'medium']} bot` : 'Ready to play'}</p>}</div>
    {onRemove && <button type="button" onClick={onRemove} data-testid={`button-remove-bot-${player.id}`} aria-label={`Remove ${player.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#94A3B8] transition hover:bg-white/10 hover:text-white"><X size={18} /></button>}
    {playing && <div className="text-right"><p className="font-mono text-sm font-bold" data-testid={`text-score-${player.id}`}>{player.score}</p><p className="font-mono text-[8px] uppercase tracking-widest text-[#94A3B8]">score</p></div>}
  </div>;
}

const BOT_LEVELS: Record<Rush10BotLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** The host's skill-level choice for one bot. */
function BotLevelPicker({ name, value, onPick }: { name: string; value: Rush10BotLevel; onPick: (level: Rush10BotLevel) => void }) {
  return <div role="radiogroup" aria-label={`${name}'s skill level`} className="mt-1.5 inline-flex rounded-lg bg-[#0F172A] p-0.5 ring-1 ring-[#334155]">
    {(Object.keys(BOT_LEVELS) as Rush10BotLevel[]).map(level => <button key={level} type="button" role="radio" aria-checked={value === level} onClick={() => { if (value !== level) onPick(level); }}
      data-testid={`button-bot-level-${level}`}
      className={`rounded-md px-3 py-1 text-xs font-bold transition ${value === level ? 'bg-[#A3E635] text-[#111827]' : 'text-[#94A3B8] hover:text-white'}`}>{BOT_LEVELS[level]}</button>)}
  </div>;
}

export function RulesPanel({ rules, loading, retry, compact = false, unboxed = false }: { rules?: Rush10Rules; loading: boolean; retry: () => void; compact?: boolean; unboxed?: boolean }) {
  const [open, setOpen] = useState(compact);
  return <div className={`h-fit text-white ${unboxed ? 'py-5 md:py-8' : 'rounded-[24px] border-2 border-white/10 bg-[#4F46E5] p-5 shadow-[var(--shadow-card)]'}`} data-testid="panel-rules">
    <div className="flex items-start justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[.2em] text-[#CBD5E1]">Quick guide</p><h2 className="mt-1 text-xl font-bold tracking-[-.04em]">How Rush 10 works</h2></div><CircleHelp size={19} className="text-[#FFB800]" /></div>
    {loading ? <div className="mt-5 space-y-2"><div className="h-7 animate-pulse rounded bg-white/10" /><div className="h-7 animate-pulse rounded bg-white/10" /></div> : !rules ? <button onClick={retry} className="mt-4 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs"><RefreshCw size={13} /> Retry loading rules</button> : <>
      <div className="mt-4 space-y-2">
        {rules.turnRules.map((rule, i) => <div key={i} className="flex gap-2 text-xs leading-relaxed text-[#CBD5E1]"><span className="font-mono text-[#FFB800]">{String(i + 1).padStart(2, '0')}</span><span>{rule}</span></div>)}
      </div>
      <button onClick={() => setOpen(!open)} className="mt-4 flex items-center gap-2 border-b border-white/20 pb-1 text-xs font-semibold text-[#FFB800]">{open ? 'Hide level list' : 'See all 10 levels'}<ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} /></button>
      {open && <div className="mt-3 space-y-2 pr-1">
        {rules.phases.map((phase) => <div key={phase.number} className={unboxed ? 'py-2.5' : 'rounded-lg bg-white/[.07] p-2.5'}><p className="text-xs font-bold"><span className="mr-2 font-mono text-[#FFB800]">{String(phase.number).padStart(2, '0')}</span>{phase.title}</p><p className="mt-1 pl-7 text-[10px] leading-relaxed text-[#CBD5E1]">{phase.description}</p></div>)}
        <p className="pt-2 font-mono text-[9px] uppercase tracking-widest text-[#CBD5E1]">Scoring</p>{rules.scoring.map((entry, i) => <p key={i} className="text-[10px] leading-relaxed text-[#CBD5E1]">{entry}</p>)}
      </div>}
    </>}
  </div>;
}
