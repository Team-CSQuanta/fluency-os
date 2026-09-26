import { LookupPanel } from '@/features/player/LookupPanel';
import { SavedClipsPanel } from '@/features/player/SavedClipsPanel';
import { useMediaStore } from '@/store/mediaStore';
import type { CueOut } from '@/types/api';

export type PanelTab = 'lookup' | 'saved';

interface Props {
  mediaId: string;
  tab: PanelTab;
  lookup: { term: string; cue: CueOut | null } | null;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  onJump: (ms: number) => void;
  onSaved: (message: string) => void;
}

/** The player's right-hand panel: one frame, two tabs.
 *
 * Word lookups and the list of moments already captured from this file are
 * the same kind of thing — what the learner is taking out of the video — and
 * they are never both needed at once. Sharing a panel also gives the saved
 * list room to be a real list rather than the single-line strip it was when
 * it lived under the transport bar.
 */
export function SidePanel({ mediaId, tab, lookup, onTab, onClose, onJump, onSaved }: Props) {
  const savedCount = useMediaStore((s) => s.clips.length);

  return (
    // Width is set by the wrapper in Player.tsx, because it differs between
    // the windowed layout (a column beside the video) and fullscreen (an
    // overlay over the right of the picture).
    <aside className="flex h-full w-full flex-col border-l border-line2 bg-panel">
      <div className="flex flex-none items-center gap-[3px] border-b border-line2 px-2 py-[7px]">
        <Tab on={tab === 'lookup'} onClick={() => onTab('lookup')}>
          Lookup
        </Tab>
        <Tab on={tab === 'saved'} onClick={() => onTab('saved')} count={savedCount}>
          Saved
        </Tab>
        <div className="flex-1" />
        <button
          onClick={onClose}
          title="close panel"
          aria-label="Close panel"
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded-field text-tx3 hover:bg-line2 hover:text-tx"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
      </div>

      {tab === 'lookup' ? (
        lookup ? (
          <LookupPanel
            // Remounts per term, so the dictionary search and the AI state
            // start clean instead of showing the previous word's answer.
            key={`${lookup.term}-${lookup.cue?.id ?? ''}`}
            mediaId={mediaId}
            term={lookup.term}
            cue={lookup.cue}
            onSaved={onSaved}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-[7px] px-6 text-center">
            <p className="font-sans text-[12.5px] text-tx2">No word selected.</p>
            <p className="font-sans text-[11.5px] leading-[1.6] text-tx3">
              Click a word in the subtitle — or drag across several for a phrase — to look it up here.
            </p>
          </div>
        )
      ) : (
        <SavedClipsPanel onJump={onJump} />
      )}
    </aside>
  );
}

function Tab({
  on,
  onClick,
  count,
  children,
}: {
  on: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-selected={on}
      role="tab"
      className="flex items-center gap-[6px] rounded-field px-[11px] py-[5px] font-sans text-[11.5px] font-medium transition-colors"
      style={{
        background: on ? 'var(--accSoft)' : 'transparent',
        color: on ? 'var(--acc)' : 'var(--tx3)',
      }}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className="rounded-full px-[5px] py-[1px] font-mono text-[9px]"
          style={{
            background: on ? 'rgba(var(--accRGB),.22)' : 'var(--line2)',
            color: on ? 'var(--acc)' : 'var(--tx3)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
