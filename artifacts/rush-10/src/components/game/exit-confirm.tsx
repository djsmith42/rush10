import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { LoaderCircle } from 'lucide-react';

/** Leaving ends the game for every player, so it always asks first. Sits above the round-results overlay. */
export function ExitConfirm({ open, onOpenChange, onConfirm, pending }: {
  open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void; pending: boolean;
}) {
  return <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="fixed inset-0 z-[250] bg-[#0B1120]/70 backdrop-blur-[2px]" />
      <AlertDialog.Content data-testid="dialog-exit-confirm"
        className="fixed left-1/2 top-1/2 z-[251] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[26px] border-2 border-white/10 bg-[#1E293B] p-6 text-center text-white shadow-[0_20px_60px_rgba(0,0,0,.6)]">
        <AlertDialog.Title className="text-2xl font-bold tracking-[-.05em]">Exit Game?</AlertDialog.Title>
        <AlertDialog.Description className="mt-3 text-sm leading-relaxed text-[#CBD5E1]">
          Are you sure you want to exit this game? This will end the game for all players.
        </AlertDialog.Description>
        <div className="mt-6 flex flex-col-reverse justify-center gap-3 sm:flex-row">
          <AlertDialog.Cancel data-testid="button-stay-in-game" className="rounded-full bg-white/10 px-6 py-3 font-bold text-white transition hover:bg-white/15">Stay in Game</AlertDialog.Cancel>
          {/* Not AlertDialog.Action: that would close the dialog before the leave request settles. */}
          <button type="button" onClick={onConfirm} disabled={pending} data-testid="button-confirm-exit"
            className="flex items-center justify-center gap-2 rounded-full bg-[#FF3366] px-6 py-3 font-bold text-white shadow-[0_8px_24px_rgba(255,51,102,.4)] transition hover:-translate-y-0.5 disabled:opacity-50">
            {pending && <LoaderCircle size={16} className="animate-spin" />} Exit Game
          </button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
