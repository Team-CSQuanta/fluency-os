import { useEffect, useRef, useState } from 'react';
import { timecode } from '@/features/player/playerFormat';
import { clipThumbUrl, useMediaStore } from '@/store/mediaStore';
import type { ClipOut } from '@/types/api';

/** Moments captured from the file that is open (spec §4.2).
 *
 * This was a strip under the transport bar, which meant it stole height from
 * the picture permanently and had room for one line of text per clip. As a
 * panel tab it costs nothing while closed and can show the line, the state of
 * the extraction, and a frame from the clip itself.
 */
export function SavedClipsPanel({ onJump }: { onJump: (ms: number) => void }) {
  const clips = useMediaStore((s) => s.clips);
  const retryClip = useMediaStore((s) => s.retryClip);
  const deleteClip = useMediaStore((s) => s.deleteClip);
  const fetchClips = useMediaStore((s) => s.fetchClips);
  const mediaId = useMediaStore((s) => s.detail?.item.id);
  const [confirming, setConfirming] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  // Extraction happens in a background task, so a row saved a second ago says
  // "cutting the clip…" and would say it for ever without this. Polling runs
  // only while this tab is open and only while something is actually pending,
  // so it stops on its own rather than ticking for the whole session.
  const pending = clips.some((c) => c.status === 'queued' || c.status === 'extracting');
  useEffect(() => {
    if (!pending) return;
    poll.current = window.setInterval(() => void fetchClips(mediaId), 1500);
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
  }, [pending, fetchClips, mediaId]);

  if (clips.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-[7px] px-6 text-center">
        <p className="font-sans text-[12.5px] text-tx2">Nothing saved from this file yet.</p>
        <p className="font-sans text-[11.5px] leading-[1.6] text-tx3">
          Click a word in the subtitle to look it up, then save it — the line and the exact moment are kept with it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-[12px]">
      <div className="flex flex-col gap-[7px]">
        {clips.map((clip) => (
          <ClipRow
            key={clip.id}
            clip={clip}
            confirming={confirming === clip.id}
            onJump={() => onJump(clip.start_ms)}
            onRetry={() => void retryClip(clip.id)}
            onAskDelete={() => setConfirming(clip.id)}
            onCancelDelete={() => setConfirming(null)}
            onConfirmDelete={() => {
              setConfirming(null);
              void deleteClip(clip.id);
            }}
          />
        ))}
      </div>
      <p className="mt-[12px] px-1 font-mono text-[9.5px] leading-[1.6] text-tx3">
        removing a moment keeps the word in your vocabulary — only the clip goes
      </p>
    </div>
  );
}

function ClipRow({
  clip,
  confirming,
  onJump,
  onRetry,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  clip: ClipOut;
  confirming: boolean;
  onJump: () => void;
  onRetry: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const pending = clip.status === 'queued' || clip.status === 'extracting';

  return (
    <div className="overflow-hidden rounded-field border border-line2 bg-panel2">
      <button onClick={onJump} title="jump back to this moment" className="flex w-full gap-[9px] p-[8px] text-left">
        <span
          className="grid h-[42px] w-[68px] flex-none place-items-center overflow-hidden rounded-[4px] font-mono text-[8px] text-tx3"
          style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 5px,var(--tileB) 5px 10px)' }}
        >
          {clip.has_thumbnail ? (
            <img src={clipThumbUrl(clip.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            timecode(clip.start_ms)
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9.5px] text-acc">{timecode(clip.start_ms)}</span>
          <span className="mt-[2px] line-clamp-2 block font-sans text-[11.5px] leading-[1.45] text-tx2">
            {clip.cue_text}
          </span>
        </span>
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-line2 px-[9px] py-[5px]">
        <span className="min-w-0 truncate font-mono text-[9px] text-tx3">
          {pending
            ? 'cutting the clip…'
            : clip.status === 'failed'
              ? (clip.error ?? 'extraction failed')
              : clip.status === 'virtual'
                ? 'timecodes only'
                : 'clip ready'}
        </span>
        <span className="flex flex-none items-center gap-[8px]">
          {clip.status === 'failed' && (
            <button onClick={onRetry} className="font-mono text-[9.5px] text-acc hover:underline">
              retry
            </button>
          )}
          {confirming ? (
            <>
              <button onClick={onCancelDelete} className="font-mono text-[9.5px] text-tx3 hover:underline">
                cancel
              </button>
              <button
                onClick={onConfirmDelete}
                className="font-mono text-[9.5px] text-[#e06c6c] hover:underline"
              >
                remove
              </button>
            </>
          ) : (
            <button onClick={onAskDelete} className="font-mono text-[9.5px] text-tx3 hover:text-[#e06c6c]">
              remove
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
