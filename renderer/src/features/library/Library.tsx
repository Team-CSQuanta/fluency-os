import { useEffect, useRef, useState } from 'react';
import { AddContentModal } from '@/features/library/AddContentModal';
import { posterUrl, useMediaStore } from '@/store/mediaStore';
import { useShellStore } from '@/store/shellStore';
import type { LibraryScope, MediaItemOut } from '@/types/api';

// Roughly the tallest the ⋯ menu gets, used only to decide whether it opens
// downwards or upwards. Being a little out just flips it a row early.
const MENU_HEIGHT = 210;

const SCOPES: Array<{ key: LibraryScope; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unfinished', label: 'Unfinished' },
  { key: 'unwatched', label: 'Not started' },
  { key: 'no-subs', label: 'No subtitles' },
];

function timecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function remaining(item: MediaItemOut): string {
  const left = item.duration_ms - (item.position_ms ?? 0);
  if (item.duration_ms <= 0) return 'length unknown';
  if (left <= 60_000) return 'nearly done';
  return `${Math.round(left / 60_000)} min left`;
}

function Thumb({ item, height }: { item: MediaItemOut; height: number }) {
  return (
    <div
      className="relative grid place-items-center overflow-hidden rounded-t-panel font-mono text-[8px] text-tx3"
      style={{
        height,
        background: 'repeating-linear-gradient(135deg,var(--tile) 0 6px,var(--tileB) 6px 12px)',
      }}
    >
      {item.has_thumbnail ? (
        <img src={posterUrl(item.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span>{item.ingest_status === 'failed' ? 'unreadable' : 'no preview'}</span>
      )}
      {item.duration_ms > 0 && (
        <span className="absolute bottom-[7px] right-2 rounded-[3px] bg-black/70 px-[5px] py-[2px] font-mono text-[9px] font-medium text-white">
          {timecode(item.duration_ms)}
        </span>
      )}
      {(item.percent_complete ?? 0) > 0 && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/35">
          <span className="block h-[3px] bg-acc" style={{ width: `${item.percent_complete}%` }} />
        </span>
      )}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <div
      className="rounded-panel border px-[14px] py-[11px] font-sans text-[11.5px] leading-[1.6]"
      style={{
        borderColor: tone === 'warn' ? 'var(--warnLine, var(--line))' : 'var(--line2)',
        background: tone === 'warn' ? 'rgba(220,140,60,.10)' : 'var(--panel2)',
        color: 'var(--tx2)',
      }}
    >
      {children}
    </div>
  );
}

export function Library() {
  const goPlayer = useShellStore((s) => s.goPlayer);
  const {
    items,
    recent,
    counts,
    scope,
    query,
    ffmpegAvailable,
    libraryBytes,
    libraryStatus,
    libraryError,
    setScope,
    setQuery,
    fetchLibrary,
    deleteMedia,
    renameMedia,
    relinkMedia,
    reingest,
    optimizeForSeeking,
  } = useMediaStore();

  const [addOpen, setAddOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuAbove, setMenuAbove] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const searchDebounce = useRef<number | null>(null);
  const firstSearchRun = useRef(true);
  const [searchText, setSearchText] = useState(query);

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  // Typing in the search box must not fire a request per keystroke; 250 ms is
  // below the threshold where a list feels laggy and well above a fast typist.
  //
  // The first-run guard matters: without it this fires on mount with the
  // search box's initial value, and setQuery refetches — so every visit to the
  // library made two identical requests instead of one.
  useEffect(() => {
    if (firstSearchRun.current) {
      firstSearchRun.current = false;
      return;
    }
    if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    searchDebounce.current = window.setTimeout(() => setQuery(searchText), 250);
    return () => {
      if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const open = (item: MediaItemOut) => {
    if (item.ingest_status === 'failed') return;
    goPlayer(item.id, item.title);
  };

  const pickAndRelink = async (id: string) => {
    const paths = await window.fluencyos.pickMediaFiles();
    if (paths.length === 0) return;
    setBusy(id);
    try {
      await relinkMedia(id, paths[0]);
    } finally {
      setBusy(null);
      setMenuFor(null);
    }
  };

  return (
    <div className="flex flex-col gap-[22px] p-[var(--pad)]" onClick={() => setMenuFor(null)}>
      {!ffmpegAvailable && (
        <Banner tone="warn">
          <strong className="font-semibold text-tx">FluencyOS can’t read video files yet.</strong> It needs a free
          video tool called ffmpeg, which isn’t on this computer. Install it (on Ubuntu or Debian, run{' '}
          <code className="font-mono">apt install ffmpeg</code> in a terminal) and restart FluencyOS. Everything
          else — books, words, review and conversation — works without it.
        </Banner>
      )}

      {recent.length > 0 && (
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
              Continue watching
            </div>
            <span className="font-mono text-[10.5px] text-tx3">{recent.length} in progress</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {recent.map((item) => (
              <button
                key={item.id}
                onClick={() => open(item)}
                className="overflow-hidden rounded-panel border border-line2 bg-panel text-left shadow-panel hover:border-acc"
              >
                <Thumb item={item} height={104} />
                <div className="px-[11px] pb-3 pt-[10px]">
                  <div className="truncate font-sans text-[12.5px] font-semibold text-tx">{item.title}</div>
                  <div className="mt-1 font-mono text-[9.5px] text-tx3">
                    {remaining(item)} · {item.saves} saves
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-[14px] flex flex-wrap items-center gap-2">
          <div className="mr-[6px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            My library
          </div>
          {SCOPES.map((s) => {
            const on = scope === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setScope(s.key)}
                className="rounded-full border px-[11px] py-[6px] font-sans text-[11px] font-medium"
                style={{
                  borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                  background: on ? 'var(--accSoft)' : 'transparent',
                  color: on ? 'var(--acc)' : 'var(--tx2)',
                }}
              >
                {s.label} <span className="font-mono text-[9.5px] opacity-60">{counts[s.key] ?? 0}</span>
              </button>
            );
          })}
          <div className="flex-1" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="search titles"
            className="w-[190px] rounded-field border border-line2 bg-transparent px-[11px] py-[6px] font-sans text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
          />
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-field bg-accSolid px-[14px] py-2 font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
          >
            + Add content
          </button>
        </div>

        {libraryStatus === 'error' && (
          <Banner tone="warn">Couldn’t load the library: {libraryError}</Banner>
        )}

        <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(212px,1fr))' }}>
          {items.map((item) => (
            <div
              key={item.id}
              // No overflow-hidden: it was here to round the thumbnail's top
              // corners, and it also clipped the ⋯ menu, which is taller than
              // the card. The thumbnail rounds itself instead. The z-index
              // lifts the open menu above the cards in the row below, which
              // would otherwise paint over it — each card builds its own
              // stacking context via the hover transform.
              className="relative rounded-panel border border-line2 bg-panel text-left shadow-panel hover:-translate-y-[1px] hover:border-acc"
              style={{ zIndex: menuFor === item.id ? 30 : undefined }}
            >
              <button onClick={() => open(item)} className="block w-full text-left">
                <Thumb item={item} height={120} />
              </button>

              <span
                className="pointer-events-none absolute left-2 top-[7px] rounded-[3px] border px-[6px] py-[2px] font-mono text-[8.5px] font-medium uppercase tracking-[0.05em]"
                style={{
                  color: item.source_missing ? '#e8a33d' : 'var(--acc)',
                  background: item.source_missing ? 'rgba(232,163,61,.16)' : 'rgba(var(--accRGB),.2)',
                  borderColor: item.source_missing ? 'rgba(232,163,61,.4)' : 'var(--accLine)',
                }}
              >
                {item.source_missing ? 'file missing' : 'local file'}
              </span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (menuFor === item.id) {
                    setMenuFor(null);
                    return;
                  }
                  const box = e.currentTarget.getBoundingClientRect();
                  setMenuAbove(window.innerHeight - box.bottom < MENU_HEIGHT);
                  setMenuFor(item.id);
                }}
                className="absolute right-2 top-[7px] grid h-[22px] w-[22px] place-items-center rounded-[4px] bg-black/55 font-mono text-[12px] leading-none text-white/80 hover:bg-black/80"
              >
                ⋯
              </button>

              {menuFor === item.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-2 z-20 w-[168px] overflow-hidden rounded-panel border border-line bg-panel shadow-[0_16px_40px_rgba(0,0,0,.4)]"
                  style={menuAbove ? { bottom: 'calc(100% - 30px)' } : { top: 34 }}
                >
                  {[
                    { label: 'Rename', run: () => setRenaming({ id: item.id, value: item.title }) },
                    { label: 'Relink file…', run: () => void pickAndRelink(item.id) },
                    { label: 'Re-scan tracks', run: () => void reingest(item.id).then(() => setMenuFor(null)) },
                    ...(item.index_at_end
                      ? [
                          {
                            label: 'Fix slow seeking',
                            run: () => {
                              setBusy(item.id);
                              void optimizeForSeeking(item.id).finally(() => {
                                setBusy(null);
                                setMenuFor(null);
                              });
                            },
                          },
                        ]
                      : []),
                    {
                      label: 'Remove from library',
                      run: () => void deleteMedia(item.id).then(() => setMenuFor(null)),
                      danger: true,
                    },
                  ].map((action) => (
                    <button
                      key={action.label}
                      onClick={action.run}
                      className="block w-full px-[12px] py-[9px] text-left font-sans text-[11.5px] hover:bg-panel2"
                      style={{ color: action.danger ? '#e06c6c' : 'var(--tx2)' }}
                    >
                      {action.label}
                    </button>
                  ))}
                  <div className="border-t border-line2 px-[12px] py-2 font-mono text-[9px] leading-[1.5] text-tx3">
                    removing never deletes your video file
                  </div>
                </div>
              )}

              <div className="px-3 pb-[13px] pt-[11px]">
                {renaming?.id === item.id ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id: item.id, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void renameMedia(item.id, renaming.value.trim() || item.title);
                        setRenaming(null);
                        setMenuFor(null);
                      }
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                    className="w-full rounded-field border border-acc bg-transparent px-2 py-1 font-sans text-[12.5px] font-semibold text-tx outline-none"
                  />
                ) : (
                  <div className="truncate font-sans text-[12.5px] font-semibold leading-[1.35] text-tx">
                    {item.title}
                  </div>
                )}
                <div className="mt-[5px] truncate font-mono text-[9.5px] text-tx3" title={item.source_path ?? ''}>
                  {item.source_path ?? item.url ?? '—'}
                </div>
                <div className="mt-[9px] flex flex-wrap items-center gap-[7px]">
                  {item.ingest_status === 'failed' ? (
                    <span
                      className="rounded-[3px] px-[6px] py-[2px] font-mono text-[9px] font-medium"
                      style={{ background: 'rgba(224,108,108,.16)', color: '#e06c6c' }}
                      title={item.ingest_error ?? ''}
                    >
                      {item.ingest_error ?? 'failed'}
                    </span>
                  ) : item.ingest_status !== 'ready' ? (
                    <span className="rounded-[3px] bg-line2 px-[6px] py-[2px] font-mono text-[9px] font-medium text-tx2">
                      reading file…
                    </span>
                  ) : (
                    <span className="rounded-[3px] bg-line2 px-[6px] py-[2px] font-mono text-[9px] font-medium text-tx2">
                      {item.subtitle_tracks > 0
                        ? `${item.subtitle_tracks} subtitle track${item.subtitle_tracks > 1 ? 's' : ''}`
                        : 'no subtitles yet'}
                    </span>
                  )}
                  {item.index_at_end && (
                    <span
                      className="rounded-[3px] px-[6px] py-[2px] font-mono text-[9px] font-medium"
                      style={{ background: 'rgba(232,163,61,.16)', color: '#e8a33d' }}
                      title="The seek index is at the end of this file, which makes jumping to a timestamp slow. Fixable from the ⋯ menu."
                    >
                      slow seeking
                    </span>
                  )}
                  <span className="font-mono text-[9.5px] text-tx3">{item.saves} saves</span>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={() => setAddOpen(true)}
            className="flex min-h-[198px] flex-col items-center justify-center gap-[9px] rounded-panel border border-dashed border-line text-tx3 hover:border-acc hover:text-acc"
          >
            <span className="font-sans text-[26px] font-light leading-none">+</span>
            <span className="font-sans text-[11.5px] font-medium">Add content</span>
            <span className="max-w-[176px] text-center font-mono text-[9.5px] leading-[1.6]">
              mp4 · mkv · avi · webm · mov
            </span>
          </button>
        </div>

        {items.length === 0 && libraryStatus === 'idle' && (
          <div className="mt-[14px] font-sans text-[11.5px] text-tx3">
            {query.trim()
              ? `Nothing in your library matches “${query.trim()}”.`
              : scope === 'all'
                ? 'Your library is empty. Add a video file to start capturing words from it.'
                : 'Nothing here under this filter.'}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-line2 pt-[14px] font-mono text-[10px] leading-[1.7] text-tx3">
        <span>
          nothing here is uploaded — your video files are read where they already are and never copied
        </span>
        <span>clips and previews on disk: {humanBytes(libraryBytes)}</span>
      </div>

      {busy && <span className="sr-only">working…</span>}
      {addOpen && <AddContentModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
