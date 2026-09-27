import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fetchBlobUrl } from '@/lib/apiClient';
import { friendlyMessage } from '@/lib/friendlyError';
import { PauseIcon, PlayIcon } from '@/features/player/PlayerIcons';
import { useAppStore } from '@/store/appStore';
import type { TtsEngine, VoiceOut, VoicesOut } from '@/types/api';

const POLL_MS = 1200;
// The error red used elsewhere in the app; readable on both themes.
const WARN = '#c0563f';

const GROUPS: Array<{ gender: VoiceOut['gender']; title: string }> = [
  { gender: 'female', title: 'Female voices' },
  { gender: 'male', title: 'Male voices' },
];

/** Which voice speaks the replies, for the engine currently selected.
 *
 * Every voice can be heard before it is chosen: that is the only honest way
 * to pick one, since a name and an accent say little about how a voice
 * sounds. Pocket TTS keeps each voice in its own ~6MB file, so hearing or
 * choosing one it does not have yet downloads it first. Replies carry on in
 * the default voice meanwhile, and the note under the list says so. */
export function VoicePicker({ engine, playbackRate }: { engine: TtsEngine | undefined; playbackRate: number }) {
  const userId = useAppStore((s) => s.currentUserId);
  const [data, setData] = useState<VoicesOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; phase: 'loading' | 'playing' } | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  // Only the latest preview request may start playing — an earlier, slower
  // one resolving afterwards must not talk over it.
  const previewToken = useRef(0);

  const load = useCallback(async () => {
    if (!userId) return;
    const qs = `user_id=${encodeURIComponent(userId)}${engine ? `&engine=${engine}` : ''}`;
    try {
      setData(await api.get<VoicesOut>(`/engine/voices?${qs}`));
    } catch (err) {
      setError(friendlyMessage(err, 'Loading the voices'));
    }
  }, [userId, engine]);

  useEffect(() => {
    void load();
  }, [load]);

  const downloading = data?.voices.some((v) => v.download.status === 'downloading') ?? false;
  useEffect(() => {
    if (!downloading) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [downloading, load]);

  const stopPreview = useCallback(() => {
    previewToken.current += 1;
    audio.current?.pause();
    audio.current = null;
    setPreview(null);
  }, []);

  useEffect(() => {
    const cache = urls.current;
    return () => {
      audio.current?.pause();
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  // A different engine is a different set of voices.
  useEffect(() => stopPreview, [engine, stopPreview]);

  const hear = async (voice: VoiceOut) => {
    if (!data) return;
    if (preview?.key === voice.key) {
      stopPreview();
      return;
    }
    stopPreview();
    const token = previewToken.current;
    setError(null);
    setPreview({ key: voice.key, phase: 'loading' });
    const cacheKey = `${data.engine}.${voice.key}`;
    try {
      let url = urls.current.get(cacheKey);
      if (!url) {
        url = await fetchBlobUrl(
          `/engine/voices/preview?engine=${data.engine}&voice=${encodeURIComponent(voice.key)}`,
        );
        urls.current.set(cacheKey, url);
      }
      if (token !== previewToken.current) return;
      const el = new Audio(url);
      el.playbackRate = playbackRate;
      el.onended = () => {
        if (token === previewToken.current) setPreview(null);
      };
      audio.current = el;
      setPreview({ key: voice.key, phase: 'playing' });
      await el.play();
      // Hearing a Pocket voice downloads it, so its "6 MB" tag is now stale.
      if (!voice.downloaded) void load();
    } catch (err) {
      if (token !== previewToken.current) return;
      setPreview(null);
      setError(friendlyMessage(err, 'Playing that voice'));
    }
  };

  const choose = async (voice: VoiceOut) => {
    if (!data || !userId || voice.key === data.chosen) return;
    setError(null);
    // Shown as chosen at once; the server answer replaces it.
    setData({ ...data, chosen: voice.key });
    try {
      setData(
        await api.put<VoicesOut>('/engine/voices', { user_id: userId, engine: data.engine, voice: voice.key }),
      );
    } catch (err) {
      setError(friendlyMessage(err, 'Choosing that voice'));
      void load();
    }
  };

  if (!data) {
    return error ? (
      <p className="font-sans text-[11px] leading-[1.55]" style={{ color: WARN }}>
        {error}
      </p>
    ) : (
      <p className="font-mono text-[10.5px] text-tx3">loading voices…</p>
    );
  }

  const chosen = data.voices.find((v) => v.key === data.chosen);
  const speaking = data.voices.find((v) => v.key === data.speaking);
  const waitingOn = chosen && speaking && chosen.key !== speaking.key ? chosen : null;

  return (
    <div>
      {GROUPS.map((group) => {
        const list = data.voices.filter((v) => v.gender === group.gender);
        if (list.length === 0) return null;
        return (
          <div key={group.gender} className="mt-[12px] first:mt-0">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
              {group.title}
            </div>
            <div
              role="radiogroup"
              aria-label={group.title}
              className="mt-[6px] grid grid-cols-2 gap-[6px] sm:grid-cols-3"
            >
              {list.map((voice) => (
                <VoiceCard
                  key={voice.key}
                  voice={voice}
                  chosen={voice.key === data.chosen}
                  canHear={data.engine_downloaded}
                  preview={preview?.key === voice.key ? preview.phase : null}
                  onChoose={() => void choose(voice)}
                  onHear={() => void hear(voice)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {!data.engine_downloaded && (
        <p className="mt-[10px] font-sans text-[11px] leading-[1.55] text-tx3">
          {data.engine_label} isn't downloaded yet, so these can't be heard. Download it on the AI page — you can
          still pick a voice now.
        </p>
      )}
      {waitingOn && data.engine_downloaded && (
        <p className="mt-[10px] font-sans text-[11px] leading-[1.55] text-tx2">
          {waitingOn.download.status === 'error' ? (
            <span style={{ color: WARN }}>
              {waitingOn.name} couldn't download ({waitingOn.download.error ?? 'connection problem'}). Replies use{' '}
              {speaking?.name} until it does — press ▶ on {waitingOn.name} to try again.
            </span>
          ) : (
            <>
              Replies use {speaking?.name} until {waitingOn.name} finishes downloading
              {waitingOn.download.total_bytes > 0 && ` (${percent(waitingOn)}%)`}.
            </>
          )}
        </p>
      )}
      {error && (
        <p className="mt-[10px] font-sans text-[11px] leading-[1.55]" style={{ color: WARN }}>
          {error}
        </p>
      )}
    </div>
  );
}

function percent(voice: VoiceOut): number {
  const { downloaded_bytes, total_bytes } = voice.download;
  return total_bytes > 0 ? Math.min(100, Math.floor((downloaded_bytes / total_bytes) * 100)) : 0;
}

function VoiceCard({
  voice,
  chosen,
  canHear,
  preview,
  onChoose,
  onHear,
}: {
  voice: VoiceOut;
  chosen: boolean;
  canHear: boolean;
  preview: 'loading' | 'playing' | null;
  onChoose: () => void;
  onHear: () => void;
}) {
  const status =
    voice.download.status === 'downloading'
      ? `${percent(voice)}%`
      : !voice.downloaded && voice.approx_size_mb > 0
        ? `${Math.round(voice.approx_size_mb)} MB`
        : null;
  const detail = [voice.accent, status].filter(Boolean).join(' · ');

  return (
    // A div, not a button: the card holds the preview button, and buttons
    // cannot nest.
    <div
      role="radio"
      aria-checked={chosen}
      tabIndex={0}
      title={voice.note ?? undefined}
      onClick={onChoose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChoose();
        }
      }}
      className="flex min-w-0 cursor-pointer items-center gap-[8px] rounded-field border px-[8px] py-[7px] outline-none transition-colors focus-visible:border-accLine"
      style={{
        borderColor: chosen ? 'var(--accLine)' : 'var(--line2)',
        background: chosen ? 'var(--accSoft)' : 'transparent',
      }}
    >
      <button
        type="button"
        disabled={!canHear}
        aria-label={preview ? `Stop ${voice.name}` : `Hear ${voice.name}`}
        title={canHear ? (preview ? 'Stop' : `Hear ${voice.name}`) : 'Download the voice engine to hear it'}
        onClick={(e) => {
          e.stopPropagation();
          onHear();
        }}
        className="flex h-[24px] w-[24px] flex-none items-center justify-center rounded-full border border-line2 text-tx2 transition-colors hover:border-accLine hover:text-acc disabled:opacity-40"
        style={preview ? { borderColor: 'var(--accLine)', color: 'var(--acc)' } : undefined}
      >
        {preview === 'loading' ? (
          <span className="h-[10px] w-[10px] animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
        ) : preview === 'playing' ? (
          <PauseIcon size={11} />
        ) : (
          <PlayIcon size={11} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate font-sans text-[12px] font-medium" style={{ color: chosen ? 'var(--acc)' : 'var(--tx)' }}>
          {voice.name}
        </div>
        <div className="truncate font-mono text-[9.5px] text-tx3">{detail || ' '}</div>
      </div>
      {chosen && <span className="flex-none font-mono text-[10px] text-acc">✓</span>}
    </div>
  );
}
