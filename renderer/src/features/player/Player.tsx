import { useEffect, useState } from 'react';
import { CUE_TEXT, CUE_TRANSLATION, cleanToken, lookupFor } from '@/features/player/playerMockData';
import { useShellStore } from '@/store/shellStore';

export function Player() {
  const nowPlaying = useShellStore((s) => s.nowPlaying);
  const goScreen = useShellStore((s) => s.goScreen);

  const [playing, setPlaying] = useState(true);
  const [word, setWord] = useState('reticent');
  const [panelOpen, setPanelOpen] = useState(true);
  const [blur, setBlur] = useState(false);
  const [autoPause, setAutoPause] = useState(true);
  const [loop, setLoop] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const lk = lookupFor(word);

  const handleSave = () => {
    setSaved(true);
    setToast(`clip extraction queued · ${word} · 6.4 s`);
  };

  const toggles = [
    { n: 'blur subs', on: blur, go: () => setBlur((v) => !v) },
    { n: 'auto-pause', on: autoPause, go: () => setAutoPause((v) => !v) },
    { n: 'loop cue', on: loop, go: () => setLoop((v) => !v) },
    { n: 'dual subs', on: true, go: () => {} },
    { n: 'generated track', on: false, go: () => {} },
  ];

  return (
    <div className="relative flex h-full w-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col bg-[#08090a]">
        <div
          className="relative grid min-h-0 flex-1 place-items-center"
          style={{ background: 'repeating-linear-gradient(135deg,rgba(255,255,255,.035) 0 8px,rgba(255,255,255,.015) 8px 16px)' }}
        >
          <div className="font-mono text-[10px] tracking-[0.06em] text-white/30">video frame · 1920×1080 · h264</div>

          <div className="absolute left-4 top-[14px] flex items-center gap-[6px]">
            <button
              onClick={() => goScreen('library')}
              className="rounded-[4px] bg-black/45 px-[9px] py-1 font-mono text-[9.5px] font-medium text-white/70 hover:bg-black/70 hover:text-white"
            >
              ‹ library
            </button>
            <span className="rounded-[4px] bg-black/45 px-2 py-1 font-mono text-[9.5px] font-medium text-white/50">
              {nowPlaying}
            </span>
            <span className="rounded-[4px] bg-black/45 px-2 py-1 font-mono text-[9.5px] font-medium text-acc">
              EN + BN dual
            </span>
          </div>

          <div className="absolute inset-x-0 bottom-[26px] flex flex-col items-center gap-[7px] px-[60px]">
            <div
              className="flex flex-wrap justify-center gap-x-[9px] gap-y-0 text-center font-sans text-[25px] leading-[1.4] text-white transition-[filter]"
              style={{ filter: blur ? 'blur(7px)' : 'none', textShadow: '0 2px 10px rgba(0,0,0,.85)' }}
            >
              {CUE_TEXT.split(' ').map((raw, i) => {
                const clean = cleanToken(raw);
                const on = clean === word || (word === 'even' && clean === 'even');
                return (
                  <span
                    key={i}
                    onClick={() => {
                      setWord(clean);
                      setPanelOpen(true);
                      setSaved(false);
                    }}
                    className="cursor-pointer rounded-[3px] px-[2px] hover:bg-white/20"
                    style={{
                      background: on ? 'rgba(62,124,90,.85)' : 'transparent',
                      borderBottom: on ? 'none' : '1px dotted rgba(255,255,255,.28)',
                    }}
                  >
                    {raw}
                  </span>
                );
              })}
            </div>
            <div className="text-center font-sans text-[17px] text-white/60" style={{ textShadow: '0 2px 10px rgba(0,0,0,.85)' }}>
              {CUE_TRANSLATION}
            </div>
          </div>
        </div>

        <div className="flex-none border-t border-white/[0.07] bg-[#0d0f0e] px-4 pb-[14px] pt-3">
          <div className="relative mb-3 h-1 cursor-pointer rounded-field bg-white/[0.12]">
            <div className="absolute inset-y-0 left-0 w-[61%] rounded-field bg-acc" />
            <div className="absolute -top-[4px] left-[61%] h-3 w-3 -translate-x-1/2 rounded-full bg-white" />
            <div className="absolute -top-[3px] left-[64.5%] h-[10px] w-[3px] bg-white/50" title="chapter marker" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPlaying((v) => !v)}
              className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white font-mono text-[12px] text-black"
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="min-w-[104px] font-mono text-[11px] text-white/55">01:14:22 / 02:01:38</span>
            <div className="h-[18px] w-px bg-white/[0.12]" />
            {toggles.map((t) => (
              <button
                key={t.n}
                onClick={t.go}
                className="rounded-[5px] border px-[10px] py-[5px] font-mono text-[10.5px] font-medium"
                style={{
                  borderColor: t.on ? 'var(--accLine)' : 'rgba(255,255,255,.14)',
                  background: t.on ? 'var(--accSoft)' : 'transparent',
                  color: t.on ? 'var(--acc)' : 'rgba(255,255,255,.6)',
                }}
              >
                {t.n}
              </button>
            ))}
            <div className="flex-1" />
            <span className="font-mono text-[10.5px] font-medium text-white/40">A = replay line · 1.0× · sub +0ms</span>
          </div>
        </div>
      </div>

      {panelOpen && (
        <aside className="flex w-[352px] flex-none flex-col border-l border-line2 bg-panel">
          <div className="flex flex-none items-start justify-between border-b border-line2 px-4 py-[14px]">
            <div>
              <div className="font-sans text-[22px] font-semibold tracking-[-0.015em] text-tx">{lk.word}</div>
              <div className="mt-[3px] font-mono text-[11px] text-tx3">
                {lk.ipa} · {lk.pos} · {lk.cefr}
              </div>
            </div>
            <div className="flex gap-[6px]">
              <button
                className="grid h-7 w-7 place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
                title="pronounce"
              >
                ▶
              </button>
              <button
                onClick={() => setPanelOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:border-acc"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-4 py-[14px]">
            <div>
              <div className="mb-[6px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                Dictionary · WordNet
              </div>
              <div className="font-sans text-[12.5px] leading-[1.6] text-tx2">{lk.dict}</div>
              <div className="mt-[5px] font-mono text-[10px] text-tx3">responded in 180 ms</div>
            </div>

            <div className="rounded-panel border border-accLine bg-accSoft p-[13px]">
              <div className="mb-2 flex items-center gap-[7px]">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-acc">
                  AI · in this context
                </span>
                <span className="font-mono text-[9px] text-tx3">not yet configured · offline stub</span>
              </div>
              <div className="font-sans text-[13px] leading-[1.65] text-tx">{lk.ai}</div>
              {lk.para && (
                <div className="mt-[9px] border-t border-accLine pt-[9px] font-sans text-[12px] leading-[1.6] text-tx2">
                  <b className="font-semibold">Line means:</b> {lk.para}
                </div>
              )}
              {lk.tags.length > 0 && (
                <div className="mt-[10px] flex flex-wrap gap-[5px]">
                  {lk.tags.map((t) => (
                    <span key={t} className="rounded-[4px] border border-accLine px-[7px] py-[3px] font-mono text-[9.5px] text-tx2">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-[11px] flex gap-[10px]">
                <button className="font-mono text-[10.5px] text-tx3 hover:text-acc">edit</button>
                <button className="font-mono text-[10.5px] text-tx3 hover:text-acc">reject</button>
                <button className="font-mono text-[10.5px] text-tx3 hover:text-acc">regenerate</button>
              </div>
            </div>

            {(lk.ex1 || lk.ex2) && (
              <div>
                <div className="mb-[7px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  Examples at your level
                </div>
                <div className="font-sans text-[12.5px] leading-[1.65] text-tx2">
                  {lk.ex1 && <div>· {lk.ex1}</div>}
                  {lk.ex2 && <div className="mt-1">· {lk.ex2}</div>}
                </div>
              </div>
            )}

            {lk.colls.length > 0 && (
              <div>
                <div className="mb-[7px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  Collocations found in this cue
                </div>
                <div className="flex flex-wrap gap-[6px]">
                  {lk.colls.map((c) => (
                    <button
                      key={c}
                      className="rounded-[5px] border border-dashed border-line px-2 py-1 font-mono text-[11px] text-tx2 hover:border-solid hover:border-acc hover:text-acc"
                    >
                      + {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-[7px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                Clip context · 6.4 s
              </div>
              <div className="overflow-hidden rounded-panel border border-line2">
                <div
                  className="grid h-24 place-items-center font-mono text-[8px] text-tx3"
                  style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 6px,var(--tileB) 6px 12px)' }}
                >
                  clip preview · 480p · muted until hover
                </div>
                <div className="border-t border-line2 px-[9px] py-[7px] font-mono text-[10px] text-tx3">
                  {nowPlaying} · 01:14:21.4 → 01:14:27.8 · pad 1000/500 ms
                </div>
              </div>
            </div>
          </div>

          <div className="flex-none border-t border-line2 px-4 py-3">
            <button
              onClick={handleSave}
              className="w-full rounded-field py-[11px] font-sans text-[12.5px] font-semibold hover:brightness-110"
              style={{
                background: saved ? 'transparent' : 'var(--acc)',
                color: saved ? 'var(--acc)' : '#fff',
                border: saved ? '1px solid var(--accLine)' : '1px solid transparent',
              }}
            >
              {saved ? '✓ Saved — clip queued' : 'Save with context'}
            </button>
            <div className="mt-[7px] text-center font-mono text-[9.5px] text-tx3">
              saves word + line + timecodes + clip job
            </div>
          </div>
        </aside>
      )}

      {toast && (
        <div className="absolute bottom-[26px] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-[10px] rounded-field border border-accLine bg-panel2 px-[14px] py-[10px] shadow-panel">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-accLine" style={{ borderTopColor: 'var(--acc)' }} />
          <span className="font-mono text-[11.5px] font-medium text-tx">{toast}</span>
        </div>
      )}
    </div>
  );
}
