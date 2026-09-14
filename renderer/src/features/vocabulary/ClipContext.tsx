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
 */
export function ClipContext({ context }: { context: VocabContextOut }) {
  const [open, setOpen] = useState(false);
  const retryClip = useMediaStore((s) => s.retryClip);
  const goPlayer = useShellStore((s) => s.goPlayer);

  const status = context.clip_status;
  const playable = Boolean(context.clip_id) && (status === 'ready' || status === 'virtual');
  // The film was removed from the library. The line and the timecode are still
  // the learner's, but there is nothing behind them any more — and saying so
  // beats a card with a timecode and no working control on it.
  const orphaned = !context.media_item_id;

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

      <div className="p-[11px]">
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
            {playable && (
              <button
                onClick={() => setOpen((v) => !v)}
                className="font-mono text-[9.5px] text-acc hover:underline"
              >
                {open ? 'hide clip' : status === 'virtual' ? 'build clip' : 'play clip'}
              </button>
            )}
            {status === 'queued' || status === 'extracting' ? (
              <span className="font-mono text-[9.5px] text-tx3">cutting the clip…</span>
            ) : null}
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
  );
}
