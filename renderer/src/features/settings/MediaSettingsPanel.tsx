import { useEffect, useState } from 'react';
import { Pill, Row, Section, Segmented, Toggle } from '@/features/settings/controls';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import { useMediaStore } from '@/store/mediaStore';
import type { MediaStorageOut } from '@/types/api';

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

/** The clip engine, and what watching is costing on disk.
 *
 * Everything here is read from the extractor rather than described: this
 * panel replaced a mock list of plausible-looking numbers ("2 folders
 * watched", "20 GB · 8.4 used") for settings that had nothing behind them.
 *
 * The clip timings that used to be listed here read-only are now sliders in
 * the Watching panel above. They were the same setting shown twice, in two
 * different shapes, which is how a page ends up disagreeing with itself.
 */
export function MediaSettingsPanel() {
  const userId = useAppStore((s) => s.currentUserId);
  const playerPrefs = useMediaStore((s) => s.playerPrefs);
  const setPlayerPrefs = useMediaStore((s) => s.setPlayerPrefs);
  const [storage, setStorage] = useState<MediaStorageOut | null>(null);
  const [purging, setPurging] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    if (!userId) return;
    setStorage(await api.get<MediaStorageOut>(`/media/storage?user_id=${encodeURIComponent(userId)}`));
  };

  // WatchingPanel, which renders this, owns the player-prefs fetch — one
  // request on mount rather than two for the same row.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const purge = async () => {
    if (!userId) return;
    setPurging(true);
    try {
      setStorage(
        await api.post<MediaStorageOut>(`/media/clips/purge-files?user_id=${encodeURIComponent(userId)}`),
      );
      setConfirming(false);
    } finally {
      setPurging(false);
    }
  };

  return (
    <>
      {playerPrefs && (
        <Section
          title="How clips are cut"
          note="Quality and whether the file is kept. The timings are above, next to the rest of the subtitle settings."
        >
          <Row
            label="Clip quality"
            sub="lower keeps the library small; these are clips of single lines, not films"
            control={
              <Segmented
                value={playerPrefs.clip_height}
                options={[360, 480, 720].map((h) => ({ value: h, label: `${h}p` }))}
                onChange={(h) => void setPlayerPrefs({ clip_height: h })}
              />
            }
          />
          <Row
            label="Keep the clip file"
            sub={
              playerPrefs.clip_store_files
                ? 'Each saved moment is cut once and kept on disk — instant to replay, at the cost of the space below.'
                : 'Only the timecodes are kept, and the clip is rebuilt from your video when you play it. No disk cost, a short wait, and nothing works if the file has moved.'
            }
            control={
              <Toggle
                label="Keep the clip file"
                checked={playerPrefs.clip_store_files}
                onChange={(v) => void setPlayerPrefs({ clip_store_files: v })}
              />
            }
          />
        </Section>
      )}

      <Section title="What watching needs" note="Read from this machine, not assumed.">
        <Row
          label="Video tools"
          sub={
            storage?.ffmpeg_available
              ? 'ffmpeg, the free tool that cuts your clips and reads subtitle tracks'
              : 'FluencyOS needs a free tool called ffmpeg, and can’t find it — without it no video can be read'
          }
          control={
            <Pill tone={storage?.ffmpeg_available ? 'ok' : 'warn'}>
              {storage ? (storage.ffmpeg_available ? (storage.ffmpeg_version ?? 'found') : 'missing') : '…'}
            </Pill>
          }
        />
        <Row
          label="Subtitle writer"
          sub="a model that listens to a film and writes subtitles, for films that have none of their own"
          control={
            <Pill tone={storage?.stt_ready ? 'ok' : 'muted'}>
              {storage ? (storage.stt_ready ? 'downloaded' : 'not downloaded') : '…'}
            </Pill>
          }
        />
        <Row
          label="Your video files"
          sub="read where you keep them — FluencyOS never copies or moves the originals"
          control={<Pill tone="ok">left in place</Pill>}
        />
      </Section>

      <Section title="Disk">
        <Row
          label="Saved moments"
          sub={storage ? `${storage.stored_clips} of ${storage.clips} have a clip file on disk` : 'counting…'}
          control={<Pill>{storage ? storage.clips : '…'}</Pill>}
        />
        <Row
          label="Space used"
          sub="clips, previews and extracted subtitle tracks"
          control={<Pill>{storage ? humanBytes(storage.total_bytes) : '…'}</Pill>}
        />
        <Row
          label="Free up space"
          sub="Deletes the clip files and keeps every saved word, line and timecode — the clips are rebuilt from your videos when you next play them."
          control={
            confirming ? (
              <div className="flex flex-none items-center gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded-field border border-line2 px-[11px] py-[5px] font-mono text-[10.5px] text-tx2"
                >
                  cancel
                </button>
                <button
                  onClick={() => void purge()}
                  disabled={purging}
                  className="rounded-field border border-[#e06c6c]/50 px-[11px] py-[5px] font-mono text-[10.5px] text-[#e06c6c] disabled:opacity-50"
                >
                  {purging ? 'deleting…' : `delete ${storage?.stored_clips ?? 0} clip files`}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                disabled={!storage || storage.stored_clips === 0}
                className="flex-none rounded-field border border-line px-[12px] py-[5px] font-mono text-[10.5px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              >
                clean up
              </button>
            )
          }
        />
      </Section>
    </>
  );
}
