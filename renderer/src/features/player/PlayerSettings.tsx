import { useState } from 'react';
import { useMediaStore } from '@/store/mediaStore';
import type { MediaTrackOut } from '@/types/api';

const SHORTCUTS: Array<[string, string]> = [
  ['space / K', 'play · pause'],
  ['A', 'replay this line'],
  ['N · P', 'next · previous line'],
  ['← →', 'back · forward 5s'],
  [', .', 'step one frame'],
  ['B', 'blur subtitles'],
  ['O', 'auto-pause at line end'],
  ['L', 'loop this line'],
  ['D', 'dual subtitles'],
  ['M · ↑ ↓', 'mute · volume'],
  ['F', 'fullscreen'],
];

/** Track selection, subtitle appearance, and generating a transcript.
 *
 * One panel rather than a menu per control: every setting here is one a
 * learner changes while a file is open and then rarely again, and hunting
 * four separate menus for "why is the second line in the wrong language" is
 * worse than one list that shows all of it at once.
 */
export function PlayerSettings({ onClose }: { onClose: () => void }) {
  const {
    detail,
    playerPrefs,
    sttReady,
    setTrack,
    setItemPrefs,
    setPlayerPrefs,
    addSidecar,
    generateSubtitles,
    cancelGeneration,
    deleteTrack,
  } = useMediaStore();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!detail || !playerPrefs) return null;

  const subtitles = detail.tracks.filter((t) => t.kind === 'subtitle');
  const audio = detail.tracks.filter((t) => t.kind === 'audio');
  const running = subtitles.find((t) => t.status === 'transcribing' || t.status === 'queued');

  const guard = async (key: string, run: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const loadSidecar = (role: 'target' | 'native') =>
    guard(`sidecar-${role}`, async () => {
      const path = await window.fluencyos.pickSubtitleFile();
      if (!path) return;
      await addSidecar(path, role);
    });

  const trackLabel = (track: MediaTrackOut) => {
    const bits = [track.label];
    if (track.cue_count > 0) bits.push(`${track.cue_count} lines`);
    if (track.status === 'failed') bits.push('unavailable');
    return bits.join(' · ');
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-[600px] flex-col overflow-hidden rounded-panel border border-line bg-panel shadow-[0_24px_60px_rgba(0,0,0,.45)]"
      >
        <div className="flex items-center justify-between border-b border-line2 px-5 py-4">
          <div>
            <div className="font-sans text-[14px] font-semibold text-tx">Subtitles & tracks</div>
            <div className="mt-[3px] truncate font-mono text-[10.5px] text-tx3">{detail.item.title}</div>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:border-acc"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-[18px]">
          {error && <p className="mb-3 font-sans text-[11.5px] text-[#e06c6c]">{error}</p>}

          <Section title="Target language line">
            <select
              value={detail.prefs.target_track_id ?? ''}
              onChange={(e) => void guard('target', () => setTrack('target', e.target.value || null))}
              className="w-full rounded-field border border-line2 bg-transparent px-[11px] py-[8px] font-sans text-[12px] text-tx outline-none focus:border-acc"
            >
              <option value="" className="bg-panel">
                off
              </option>
              {subtitles
                .filter((t) => t.cue_count > 0)
                .map((t) => (
                  <option key={t.id} value={t.id} className="bg-panel">
                    {trackLabel(t)}
                  </option>
                ))}
            </select>
            <Row>
              <button onClick={() => void loadSidecar('target')} className="flex-none font-mono text-[10.5px] text-tx2 hover:text-acc hover:underline">
                load a .srt / .vtt / .ass…
              </button>
            </Row>
          </Section>

          <Section title="Native language line">
            <select
              value={detail.prefs.native_track_id ?? ''}
              onChange={(e) => void guard('native', () => setTrack('native', e.target.value || null))}
              className="w-full rounded-field border border-line2 bg-transparent px-[11px] py-[8px] font-sans text-[12px] text-tx outline-none focus:border-acc"
            >
              <option value="" className="bg-panel">
                off
              </option>
              {subtitles
                .filter((t) => t.cue_count > 0)
                .map((t) => (
                  <option key={t.id} value={t.id} className="bg-panel">
                    {trackLabel(t)}
                  </option>
                ))}
            </select>
            <Row>
              <button onClick={() => void loadSidecar('native')} className="flex-none font-mono text-[10.5px] text-tx2 hover:text-acc hover:underline">
                load a translated file…
              </button>
            </Row>
          </Section>

          <Section title="Generate a transcript">
            {running ? (
              <div className="flex items-center gap-3">
                <div className="h-[4px] flex-1 rounded-full bg-line2">
                  <div
                    className="h-[4px] rounded-full bg-acc transition-[width]"
                    style={{ width: `${Math.round((running.progress ?? 0) * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[10.5px] text-tx3">
                  {Math.round((running.progress ?? 0) * 100)}%
                </span>
                <button onClick={() => void cancelGeneration(running.id)} className="flex-none font-mono text-[10.5px] text-tx2 hover:text-acc hover:underline">
                  stop
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => void guard('generate', generateSubtitles)}
                  disabled={!sttReady || busy === 'generate'}
                  className="rounded-field border border-line px-[13px] py-[7px] font-sans text-[11.5px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
                >
                  {busy === 'generate' ? 'starting…' : 'Transcribe this file with Whisper'}
                </button>
                <Note>
                  {sttReady
                    ? 'Runs locally and takes roughly as long as a third of the film. Lines appear as they are decoded, and the track is always labelled “generated” — it is a machine’s guess, not a published subtitle.'
                    : 'The speech-to-text model isn’t downloaded yet — get it in Settings → Models first.'}
                </Note>
              </>
            )}
          </Section>

          <Section title="Timing">
            <Row>
              <span className="font-sans text-[12px] text-tx2">Subtitle delay</span>
              <div className="flex items-center gap-[6px]">
                <Stepper onClick={() => void setItemPrefs({ subtitle_delay_ms: detail.prefs.subtitle_delay_ms - 100 })}>
                  −100 ms
                </Stepper>
                <span className="w-[76px] text-center font-mono text-[11px] tabular-nums text-tx">
                  {detail.prefs.subtitle_delay_ms > 0 ? '+' : ''}
                  {detail.prefs.subtitle_delay_ms} ms
                </span>
                <Stepper onClick={() => void setItemPrefs({ subtitle_delay_ms: detail.prefs.subtitle_delay_ms + 100 })}>
                  +100 ms
                </Stepper>
              </div>
            </Row>
            <Note>Positive delays show the line later. Saved per file, because the offset belongs to the file.</Note>
          </Section>

          <Section title="Appearance">
            <Slider
              label="Text size"
              value={playerPrefs.sub_size}
              min={14}
              max={44}
              step={1}
              suffix="px"
              onChange={(v) => void setPlayerPrefs({ sub_size: v })}
            />
            <Slider
              label="Background"
              value={playerPrefs.sub_opacity}
              min={0}
              max={0.9}
              step={0.05}
              suffix=""
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => void setPlayerPrefs({ sub_opacity: v })}
            />
            <Slider
              label="Distance from bottom"
              value={playerPrefs.sub_offset}
              min={8}
              max={180}
              step={2}
              suffix="px"
              onChange={(v) => void setPlayerPrefs({ sub_offset: v })}
            />
          </Section>

          {subtitles.length > 0 && (
            <Section title="All tracks in this file">
              <div className="flex flex-col overflow-hidden rounded-panel border border-line2">
                {subtitles.map((t, i) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 px-[13px] py-[9px]"
                    style={{ borderBottom: i < subtitles.length - 1 ? '1px solid var(--line2)' : 'none' }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-sans text-[11.5px] text-tx">{t.label}</span>
                      <span className="mt-[2px] block font-mono text-[9.5px] text-tx3">
                        {t.error ?? `${t.cue_count} lines · ${t.status}`}
                      </span>
                    </span>
                    {t.origin !== 'embedded' && (
                      <button onClick={() => void guard(t.id, () => deleteTrack(t.id))} className="flex-none font-mono text-[10px] text-[#e06c6c] hover:underline">
                        remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {audio.length > 1 && (
            <Section title="Audio tracks">
              <Note>
                This file carries {audio.length} audio tracks ({audio.map((a) => a.language ?? 'untagged').join(', ')}
                ). Chromium plays only the default one, so switching between them isn’t available here yet.
              </Note>
            </Section>
          )}

          <Section title="Clips">
            <Slider
              label="Start this early"
              value={playerPrefs.clip_pad_before_ms}
              min={0}
              max={4000}
              step={100}
              suffix=" ms"
              onChange={(v) => void setPlayerPrefs({ clip_pad_before_ms: v })}
            />
            <Slider
              label="Run on this long"
              value={playerPrefs.clip_pad_after_ms}
              min={0}
              max={4000}
              step={100}
              suffix=" ms"
              onChange={(v) => void setPlayerPrefs({ clip_pad_after_ms: v })}
            />
            <Slider
              label="Never longer than"
              value={playerPrefs.clip_max_ms}
              min={3000}
              max={20000}
              step={1000}
              suffix=""
              format={(v) => `${Math.round(v / 1000)} s`}
              onChange={(v) => void setPlayerPrefs({ clip_max_ms: v })}
            />
            <Row>
              <span className="font-sans text-[12px] text-tx2">Clip height</span>
              <select
                value={playerPrefs.clip_height}
                onChange={(e) => void setPlayerPrefs({ clip_height: Number(e.target.value) })}
                className="rounded-field border border-line2 bg-transparent px-[9px] py-[5px] font-mono text-[10.5px] text-tx outline-none focus:border-acc"
              >
                {[360, 480, 720].map((h) => (
                  <option key={h} value={h} className="bg-panel">
                    {h}p
                  </option>
                ))}
              </select>
            </Row>
            <Row>
              <span className="font-sans text-[12px] text-tx2">Keep clip files</span>
              <button
                onClick={() => void setPlayerPrefs({ clip_store_files: !playerPrefs.clip_store_files })}
                className="rounded-full border px-[11px] py-[4px] font-mono text-[10px]"
                style={{
                  borderColor: playerPrefs.clip_store_files ? 'var(--accLine)' : 'var(--line2)',
                  background: playerPrefs.clip_store_files ? 'var(--accSoft)' : 'transparent',
                  color: playerPrefs.clip_store_files ? 'var(--acc)' : 'var(--tx3)',
                }}
              >
                {playerPrefs.clip_store_files ? 'stored on disk' : 'timecodes only'}
              </button>
            </Row>
            <Note>
              Turning this off saves no video at all — only where in the file the moment was — and the clip is cut
              from the original the first time you play it. Smaller library, but it stops working if you move or
              delete the film.
            </Note>
          </Section>

          <Section title="Keyboard">
            <div className="grid grid-cols-2 gap-x-5 gap-y-[5px]">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[10.5px] text-tx">{keys}</span>
                  <span className="font-sans text-[11px] text-tx3">{what}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-[20px]">
      <div className="mb-[8px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
        {title}
      </div>
      <div className="flex flex-col gap-[8px]">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3">{children}</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="font-sans text-[11px] leading-[1.6] text-tx3">{children}</p>;
}

function Stepper({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-field border border-line2 px-[9px] py-[4px] font-mono text-[10.5px] text-tx2 hover:border-acc hover:text-acc"
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  format?: (v: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="w-[150px] flex-none font-sans text-[12px] text-tx2">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-[3px] flex-1 accent-[var(--acc)]"
      />
      <span className="w-[52px] flex-none text-right font-mono text-[10.5px] tabular-nums text-tx3">
        {format ? format(value) : `${value}${suffix}`}
      </span>
    </div>
  );
}
