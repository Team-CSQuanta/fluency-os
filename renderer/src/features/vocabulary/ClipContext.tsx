import { useState } from 'react';
import { clipThumbUrl, clipUrl, useMediaStore } from '@/store/mediaStore';
import { useShellStore } from '@/store/shellStore';
import type { VocabContextOut } from '@/types/api';

/** A context captured while watching, with the moment attached.
 *
 * This is the payoff of the clip context engine (spec §4.2): the card is not
 * a quotation of a line, it is the line, played back. The clip loads only when
 * asked for — a word met in eight films would otherwise pull eight videos into
 * memory to render one panel.
 *
 * The still is what invites the click. A text link reading "play clip" said
 * what would happen but showed nothing of it, so a page of saved words was a
 * page of quotations with no sign that any of them moved.
 */
export function ClipContext({ context }: { context: VocabContextOut }) {
  const [open, setOpen] = useState(false);
  // A clip shorter than one frame interval has no midpoint to grab, and a
  // source that has moved has nothing to grab from. Either way the card keeps
  // its play control and loses only the picture behind it.
  const [thumbFailed, setThumbFailed] = useState(false);
  const retryClip = useMediaStore((s) => s.retryClip);
  const goPlayer = useShellStore((s) => s.goPlayer);

  const status = context.clip_status;
  const playable = Boolean(context.clip_id) && (status === 'ready' || status === 'virtual');
  // The film was removed from the library. The line and the timecode are still
  // the learner's, but there is nothing behind them any more — and saying so
  // beats a card with a timecode and no working control on it.
  const orphaned = !context.media_item_id;
  const building = status === 'queued' || status === 'extracting';

  return (
    <div className="overflow-hidden rounded-field border border-line2 bg-panel">
      {open && playable && (
        <video
          src={clipUrl(context.clip_id!)}
          poster={clipThumbUrl(context.clip_id!)}
          controls
          autoPlay
          className="w-full bg-black"
        />
      )}

      <div className="flex gap-[11px] p-[11px]">
        {!open && (playable || building) && (
          <button
            onClick={() => playable && setOpen(true)}
            disabled={!playable}
            title={
              building
                ? 'Still being cut from the film'
                : status === 'virtual'
                  ? 'Build this moment from the film and play it'
                  : 'Play this moment'
            }
            className="group relative h-[63px] w-[112px] flex-none overflow-hidden rounded-[5px] border border-line2 bg-black disabled:cursor-default"
          >
            {!thumbFailed && context.clip_id && (
              <img
                src={clipThumbUrl(context.clip_id)}
                alt=""
                onError={() => setThumbFailed(true)}
                className="h-full w-full object-cover opacity-80 transition-opacity duration-150 group-hover:opacity-100"
              />
            )}
            <span className="absolute inset-0 grid place-items-center">
              <span
                className="grid h-[27px] w-[27px] place-items-center rounded-full border border-white/25 transition-colors duration-150 group-hover:border-white/60"
                style={{ background: 'rgba(0,0,0,.52)' }}
              >
                {building ? (
                  <span className="h-[9px] w-[9px] rounded-[2px] bg-white/70" />
                ) : (
                  <svg viewBox="0 0 12 12" className="h-[11px] w-[11px] translate-x-[1px]" aria-hidden>
                    <path d="M2.5 1.4 10 6l-7.5 4.6z" fill="rgba(255,255,255,.92)" />
                  </svg>
                )}
              </span>
            </span>
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="font-sans text-[12.5px] leading-[1.7] text-tx">“{context.snippet}”</div>
          {orphaned && (
            <p className="mt-[7px] font-sans text-[11px] leading-[1.55] text-tx3">
              The video this came from is no longer in your library, so the clip is gone. Add the same file back and
              this moment reattaches to it by itself.
            </p>
          )}

          <div className="mt-[7px] flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[9.5px] text-tx3">{context.source_label}</span>
            <span className="flex items-center gap-[9px]">
              {open && playable && (
                <button
                  onClick={() => setOpen(false)}
                  className="font-mono text-[9.5px] text-acc hover:underline"
                >
                  hide clip
                </button>
              )}
              {building ? <span className="font-mono text-[9.5px] text-tx3">cutting the clip…</span> : null}
              {status === 'failed' && context.clip_id && (
                <button
                  onClick={() => void retryClip(context.clip_id!)}
                  className="font-mono text-[9.5px] text-[#e06c6c] hover:underline"
                >
                  clip failed — retry
                </button>
              )}
              {context.media_item_id && (
                <button
                  onClick={() => goPlayer(context.media_item_id!, context.source_label.split(' · ')[0])}
                  className="font-mono text-[9.5px] text-tx2 hover:text-acc hover:underline"
                >
                  open in player
                </button>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
