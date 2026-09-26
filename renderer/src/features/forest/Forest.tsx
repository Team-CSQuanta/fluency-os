import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useForestStore, visibleTrees } from '@/store/forestStore';
import { useShellStore } from '@/store/shellStore';
import type { TreeOut } from '@/types/api';

/* three.js is about 600 KB and is needed on exactly one screen. Loaded on
 * demand it stays out of the startup bundle entirely, so opening the app — or
 * any other screen — never pays for it. */
const ForestScene = lazy(() =>
  import('@/features/forest/three/ForestScene').then((m) => ({ default: m.ForestScene })),
);

const FOCUS_DURATIONS = [15, 25, 45, 60];

/** Spec §8 — the Forest.
 *
 * Every tree is one saved word, and its size is that word's FSRS stability.
 * Nothing on this screen is decorative state: it is a drawing of the
 * scheduler, so the only way to grow it is to remember things for longer.
 */
export function Forest() {
  const { forest, loading, error, focus } = useForestStore();
  const { fetchForest, startFocus, completeFocus, clearFocus } = useForestStore();
  const goWord = useShellStore((s) => s.goWord);
  const focusWord = useShellStore((s) => s.forestFocus);
  const [hover, setHover] = useState<TreeOut | null>(null);
  /* The tree the learner last clicked. Starts unset, so an arrival from
   * "see plant" shows that word until they pick another. */
  const [picked, setPicked] = useState<TreeOut | null>(null);

  useEffect(() => {
    void fetchForest();
  }, [fetchForest]);

  /* No unmount cleanup here on purpose.
   *
   * Clearing the focus on unmount looks right and is wrong: StrictMode mounts,
   * unmounts and remounts every component in development, so the cleanup fired
   * immediately and wiped the highlight before it could be seen. `goScreen`
   * already clears the focus whenever the learner navigates anywhere, which
   * covers the same ground without depending on mount timing. */

  const trees = useMemo(() => visibleTrees(forest), [forest]);

  /* Arriving from "see plant" should name the word, not just ring it. The
   * hovered tree still wins, so moving the pointer explores as usual. */
  const focused = useMemo(
    () => (focusWord ? (forest?.trees.find((t) => t.word === focusWord) ?? null) : null),
    [forest, focusWord],
  );
  /* Hover wins while the pointer is over a tree, so the forest still explores
   * by pointing. Otherwise the last click, and failing that the word arrived
   * at. */
  const shown = hover ?? picked ?? focused;
  const marked = (picked ?? focused)?.word ?? null;

  // A ring pointing at a tree that is no longer there is worse than no ring.
  useEffect(() => {
    if (picked && !trees.some((t) => t.word === picked.word)) setPicked(null);
  }, [picked, trees]);

  if (loading && !forest) {
    return <div className="grid h-full place-items-center font-mono text-[11px] text-tx3">reading your forest…</div>;
  }
  if (!forest) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="font-sans text-[13px] text-tx2">{error ?? 'The forest could not be read.'}</p>
      </div>
    );
  }

  const tallest = forest.trees.reduce((a, b) => (b.stage > a.stage ? b : a), forest.trees[0]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col p-[var(--pad)]">


        <div className="relative min-h-0 flex-1 overflow-hidden rounded-panel border border-line2">
          {trees.length === 0 ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <p className="font-sans text-[13px] text-tx2">Nothing grows here yet.</p>
                <p className="mt-[6px] max-w-[380px] font-mono text-[10px] leading-[1.7] text-tx3">
                  Every word you save becomes a tree, and it grows each time you remember it. Save
                  one while watching or reading and it will be standing here.
                </p>
              </div>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="grid h-full place-items-center font-mono text-[11px] text-tx3">
                  growing the forest…
                </div>
              }
            >
              <ForestScene
                trees={trees}
                focusWord={focusWord}
                markedWord={marked}
                onHover={setHover}
                onSelect={setPicked}
              />
            </Suspense>
          )}

          {shown && (
            <button
              onClick={() => goWord(shown.word)}
              /* Solid and dark rather than a translucent panel. This sits over
               * bright grass, not over the app's own background, so theme
               * colours meant for a page had almost no contrast against it.
               *
               * The background is an inline style, not a class. As an
               * arbitrary Tailwind colour with an opacity modifier
               * (`bg-[#12160f]/92`) it silently produced no background at all —
               * computed style said rgba(0,0,0,0) — leaving pale text floating
               * on green and looking exactly like the bug it was meant to fix. */
              style={{ backgroundColor: 'rgba(17, 21, 14, 0.94)' }}
              className="absolute left-[12px] top-[12px] max-w-[300px] rounded-field p-[12px] text-left shadow-lg ring-1 ring-white/10"
            >
              <div className="font-sans text-[13.5px] font-semibold text-white">{shown.word}</div>
              <div className="mt-[4px] font-mono text-[10px] leading-[1.7] text-white/70">
                {forest.stage_names[shown.stage]} · holds for {shown.stability.toFixed(1)} days
                <br />
                health {shown.health}%
                {shown.lapses > 0 && ` · forgotten ${shown.lapses}×`}
                {shown.spontaneous_uses > 0 && ` · said unprompted ${shown.spontaneous_uses}×`}
                {shown.dormant && ' · dormant'}
              </div>
              {shown.dormant && (
                <div className="mt-[7px] font-mono text-[10px] leading-[1.6] text-white/60">
                  dormant · review it and it comes back
                </div>
              )}
            </button>
          )}

          <div
            style={{ backgroundColor: 'rgba(17, 21, 14, 0.78)' }}
            className="pointer-events-none absolute bottom-[10px] right-[12px] rounded-full px-[11px] py-[5px] font-mono text-[10px] text-white/80"
          >
            drag to orbit · scroll to zoom
          </div>
        </div>

        {error && (
          <div className="mt-[10px] rounded-field border border-line2 px-[12px] py-[8px] font-sans text-[11.5px] text-[#e06c6c]">
            {error}
          </div>
        )}
      </div>

      <aside className="flex w-[260px] flex-none flex-col gap-[16px] overflow-y-auto border-l border-line2 p-[16px]">
        <div>
          <Label>Growth</Label>
          <div className="mt-[7px] flex flex-col gap-[4px]">
            {forest.stage_names.map((name, i) => (
              <div key={name} className="flex items-center justify-between gap-2">
                <span className="font-sans text-[11.5px] text-tx2">{name}</span>
                <span className="font-mono text-[11px] tabular-nums text-tx3">
                  {forest.stages[i]}
                </span>
              </div>
            ))}
          </div>
          {forest.dormant > 0 && (
            <p className="mt-[7px] font-mono text-[9.5px] leading-[1.6] text-[#d0a05a]">
              {forest.dormant} dormant — a month or more past due
            </p>
          )}
        </div>

        {tallest && tallest.stage > 0 && (
          <div>
            <Label>Tallest tree</Label>
            <button
              onClick={() => goWord(tallest.word)}
              className="mt-[5px] block text-left font-sans text-[13px] font-semibold text-tx hover:text-acc"
            >
              {tallest.word}
            </button>
            <div className="font-mono text-[9.5px] text-tx3">
              {forest.stage_names[tallest.stage]} · {tallest.stability.toFixed(0)} days
            </div>
          </div>
        )}

        <div>
          <Label>Focus session</Label>
          {focus && !focus.completed_at ? (
            <div className="mt-[6px]">
              <p className="font-sans text-[11.5px] text-tx2">{focus.minutes} minutes running.</p>
              <button
                onClick={() => void completeFocus()}
                className="mt-[7px] w-full rounded-field bg-accSolid px-[11px] py-[7px] font-sans text-[11px] font-semibold text-white"
              >
                I sat it through
              </button>
              <button
                onClick={clearFocus}
                className="mt-[5px] w-full font-mono text-[10px] text-tx3 hover:text-acc"
              >
                give up
              </button>
            </div>
          ) : focus?.completed_at ? (
            <div className="mt-[6px]">
              <p className="font-sans text-[11.5px] text-tx2">
                Done — {focus.minutes} minutes sat through.
              </p>
              <button
                onClick={clearFocus}
                className="mt-[6px] font-mono text-[10px] text-acc hover:underline"
              >
                another
              </button>
            </div>
          ) : (
            <div className="mt-[6px] flex flex-wrap gap-[5px]">
              {FOCUS_DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => void startFocus(d)}
                  className="rounded-field border border-line2 px-[10px] py-[5px] font-mono text-[10.5px] text-tx2 hover:border-acc hover:text-acc"
                >
                  {d}m
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="mt-auto font-mono text-[9px] leading-[1.7] text-tx3">
          a tree is one word, and its height is how long you can go before forgetting it
        </p>
      </aside>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
      {children}
    </div>
  );
}
