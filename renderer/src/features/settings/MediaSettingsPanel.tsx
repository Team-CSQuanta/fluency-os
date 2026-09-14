import { useEffect, useState } from 'react';
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

/** Settings → Media, reading the clip engine's real configuration.
 *
 * This panel replaces a mock list that displayed plausible-looking values
 * ("2 folders watched", "20 GB · 8.4 used") for settings that had no engine
 * behind them. Everything here is now the value the extractor actually uses.
 */
export function MediaSettingsPanel() {
  const userId = useAppStore((s) => s.currentUserId);
  const { playerPrefs, fetchPlayerPrefs, setPlayerPrefs } = useMediaStore();
  const [storage, setStorage] = useState<MediaStorageOut | null>(null);
  const [purging, setPurging] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    if (!userId) return;
    setStorage(await api.get<MediaStorageOut>(`/media/storage?user_id=${encodeURIComponent(userId)}`));
  };

  useEffect(() => {
    void fetchPlayerPrefs();
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
    <div className="mt-5 flex flex-col gap-[14px]">
      <div className="overflow-hidden rounded-panel border border-line2 bg-panel">
        <Row
          label="ffmpeg"
          sub={
            storage?.ffmpeg_available
              ? (storage.ffmpeg_version ?? 'found')
              : 'not found — video files cannot be read'
          }
          value={storage?.ffmpeg_available ? 'ready' : 'missing'}
          tone={storage?.ffmpeg_available ? 'ok' : 'warn'}
        />
        <Row
          label="Speech-to-text model"
          sub="needed only to generate subtitles for files that have none"
          value={storage?.stt_ready ? 'downloaded' : 'not downloaded'}
          tone={storage?.stt_ready ? 'ok' : 'muted'}
        />
        <Row
          label="Source files"
          sub="read where you keep them — FluencyOS never copies or moves your videos"
          value="in place"
        />
      </div>

      {playerPrefs && (
        <div className="overflow-hidden rounded-panel border border-line2 bg-panel">
          <Row
            label="Clip height"
            sub="lower keeps the library small"
            control={
              <select
                value={playerPrefs.clip_height}
                onChange={(e) => void setPlayerPrefs({ clip_height: Number(e.target.value) })}
                className="rounded-field border border-line2 bg-transparent px-[9px] py-[5px] font-mono text-[11px] text-tx outline-none focus:border-acc"
              >
                {[360, 480, 720].map((h) => (
                  <option key={h} value={h} className="bg-panel">
                    {h}p
                  </option>
                ))}
              </select>
            }
          />
          <Row
            label="Clip padding before"
            sub="clamped to the previous line, so a clip never opens mid-sentence"
            value={`${playerPrefs.clip_pad_before_ms} ms`}
          />
          <Row label="Clip padding after" sub="" value={`${playerPrefs.clip_pad_after_ms} ms`} />
          <Row
            label="Maximum clip length"
            sub="a long line loses its tail, not its opening"
            value={`${Math.round(playerPrefs.clip_max_ms / 1000)} s`}
          />
          <Row
            label="Storage mode"
            sub={
              playerPrefs.clip_store_files
                ? 'clips are cut and kept on disk'
                : 'only the timecodes are kept; clips are rebuilt from the source when played'
            }
            control={
              <button
                onClick={() => void setPlayerPrefs({ clip_store_files: !playerPrefs.clip_store_files })}
                className="rounded-full border px-[11px] py-[4px] font-mono text-[10.5px]"
                style={{
                  borderColor: playerPrefs.clip_store_files ? 'var(--accLine)' : 'var(--line2)',
                  background: playerPrefs.clip_store_files ? 'var(--accSoft)' : 'transparent',
                  color: playerPrefs.clip_store_files ? 'var(--acc)' : 'var(--tx3)',
                }}
              >
                {playerPrefs.clip_store_files ? 'store clip' : 'timecodes only'}
              </button>
            }
          />
          <div className="px-4 py-[10px] font-mono text-[10px] leading-[1.6] text-tx3">
            padding and length are also on the ⚙ panel inside the player, where you can see their effect
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-panel border border-line2 bg-panel">
        <Row
          label="Saved moments"
          sub={
            storage
              ? `${storage.stored_clips} of ${storage.clips} have a clip file on disk`
              : 'counting…'
          }
          value={storage ? `${storage.clips}` : '—'}
        />
        <Row
          label="On disk"
          sub="clips, previews and extracted subtitle tracks"
          value={storage ? humanBytes(storage.total_bytes) : '—'}
        />
        <div className="flex items-center justify-between gap-5 px-4 py-[14px]">
          <div className="min-w-0">
            <div className="font-sans text-[12.5px] font-medium text-tx">Free up space</div>
            <div className="mt-[3px] font-mono text-[10.5px] leading-[1.6] text-tx3">
              deletes the clip files but keeps every saved word, line and timecode — clips are rebuilt from your
              videos when you next play them
            </div>
          </div>
          {confirming ? (
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
                {purging ? 'deleting…' : 'delete clip files'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={!storage || storage.stored_clips === 0}
              className="flex-none rounded-field border border-line px-[13px] py-[6px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
            >
              clean up
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  sub,
  value,
  control,
  tone = 'default',
}: {
  label: string;
  sub: string;
  value?: string;
  control?: React.ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'muted';
}) {
  const colour =
    tone === 'ok' ? 'var(--acc)' : tone === 'warn' ? '#e8a33d' : tone === 'muted' ? 'var(--tx3)' : 'var(--tx2)';
  return (
    <div className="flex items-center justify-between gap-5 border-b border-line2 px-4 py-[14px] last:border-b-0">
      <div className="min-w-0">
        <div className="font-sans text-[12.5px] font-medium text-tx">{label}</div>
        {sub && <div className="mt-[3px] font-mono text-[10.5px] leading-[1.6] text-tx3">{sub}</div>}
      </div>
      {control ?? (
        <span className="flex-none font-mono text-[11px]" style={{ color: colour }}>
          {value}
        </span>
      )}
    </div>
  );
}
