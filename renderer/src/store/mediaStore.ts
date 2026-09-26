import { create } from 'zustand';
import { api, fileUrl } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type {
  ClipOut,
  CueOut,
  LibraryOut,
  LibraryScope,
  MediaDetailOut,
  MediaItemOut,
  MediaItemPrefsOut,
  MediaTrackOut,
  PlayerPrefsOut,
  ProgressOut,
  SaveFromVideoOut,
} from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

/** How often an in-flight import or transcription is re-checked. Ingest is a
 * few seconds for a short file and a minute for a long one with several
 * subtitle tracks, so this polls rather than guessing a duration. */
const POLL_INTERVAL_MS = 1500;

export interface ImportQueueItem {
  path: string;
  name: string;
  mediaId: string | null;
  status: 'queued' | 'probing' | 'ready' | 'failed';
  error: string | null;
}

interface MediaState {
  // library
  items: MediaItemOut[];
  recent: MediaItemOut[];
  counts: Record<string, number>;
  scope: LibraryScope;
  query: string;
  ffmpegAvailable: boolean;
  sttReady: boolean;
  libraryBytes: number;
  libraryStatus: 'idle' | 'loading' | 'error';
  libraryError: string | null;
  importQueue: ImportQueueItem[];

  // the open file
  detail: MediaDetailOut | null;
  detailStatus: 'idle' | 'loading' | 'error';
  detailError: string | null;
  targetCues: CueOut[];
  nativeCues: CueOut[];
  playerPrefs: PlayerPrefsOut | null;
  clips: ClipOut[];

  setScope: (scope: LibraryScope) => void;
  setQuery: (query: string) => void;
  fetchLibrary: () => Promise<void>;
  importMedia: (paths: string[]) => Promise<void>;
  clearImportQueue: () => void;
  deleteMedia: (mediaId: string) => Promise<void>;
  renameMedia: (mediaId: string, title: string) => Promise<void>;
  relinkMedia: (mediaId: string, path: string) => Promise<void>;
  reingest: (mediaId: string) => Promise<void>;
  optimizeForSeeking: (mediaId: string) => Promise<string | null>;

  openMedia: (mediaId: string) => Promise<void>;
  closeMedia: () => void;
  loadCues: (trackId: string, role: 'target' | 'native') => Promise<void>;
  setTrack: (role: 'target' | 'native', trackId: string | null) => Promise<void>;
  setItemPrefs: (patch: Partial<MediaItemPrefsOut>) => Promise<void>;
  addSidecar: (path: string, role: 'target' | 'native') => Promise<void>;
  generateSubtitles: () => Promise<void>;
  cancelGeneration: (trackId: string) => Promise<void>;
  deleteTrack: (trackId: string) => Promise<void>;
  refreshDetail: () => Promise<void>;

  fetchPlayerPrefs: () => Promise<void>;
  setPlayerPrefs: (patch: Partial<PlayerPrefsOut>) => Promise<void>;

  saveProgress: (mediaId: string, positionMs: number, watchedDeltaMs: number) => Promise<void>;
  saveWord: (payload: SaveWordPayload) => Promise<SaveFromVideoOut>;
  fetchClips: (mediaId?: string) => Promise<void>;
  retryClip: (clipId: string) => Promise<void>;
  deleteClip: (clipId: string) => Promise<void>;
}

export interface SaveWordPayload {
  mediaId: string;
  word: string;
  cueId: string | null;
  cueText: string;
  startMs: number;
  endMs: number;
  pos?: string;
  definition?: string;
  example?: string | null;
  synonyms?: string[];
  ipa?: string | null;
  audioUrl?: string | null;
  note?: string | null;
  aiDefinition?: string | null;
  aiExamples?: string[];
  aiMnemonic?: string | null;
  aiUsageNote?: string | null;
  aiSenseDefinition?: string | null;
}

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user — cannot open the watching library yet');
  return id;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function streamUrl(mediaId: string): string {
  return fileUrl(`/media/${mediaId}/stream`);
}

export function posterUrl(mediaId: string): string {
  return fileUrl(`/media/${mediaId}/thumbnail`);
}

export function clipUrl(clipId: string): string {
  return fileUrl(`/media/clips/${clipId}/file`);
}

export function clipThumbUrl(clipId: string): string {
  return fileUrl(`/media/clips/${clipId}/thumbnail`);
}

export const useMediaStore = create<MediaState>((set, get) => ({
  items: [],
  recent: [],
  counts: {},
  scope: 'all',
  query: '',
  ffmpegAvailable: true,
  sttReady: false,
  libraryBytes: 0,
  libraryStatus: 'idle',
  libraryError: null,
  importQueue: [],

  detail: null,
  detailStatus: 'idle',
  detailError: null,
  targetCues: [],
  nativeCues: [],
  playerPrefs: null,
  clips: [],

  setScope: (scope) => {
    set({ scope });
    void get().fetchLibrary();
  },

  setQuery: (query) => {
    set({ query });
    void get().fetchLibrary();
  },

  fetchLibrary: async () => {
    set({ libraryStatus: 'loading', libraryError: null });
    try {
      const userId = requireUserId();
      const { scope, query } = get();
      const params = new URLSearchParams({ user_id: userId, scope });
      if (query.trim()) params.set('q', query.trim());
      const data = await api.get<LibraryOut>(`/media?${params.toString()}`);
      set({
        // Defaulted: a list that comes back absent would become undefined
        // and take down whichever screen maps over it next.
        items: data.items ?? [],
        recent: data.recent ?? [],
        counts: data.counts,
        ffmpegAvailable: data.ffmpeg_available,
        sttReady: data.stt_ready,
        libraryBytes: data.library_bytes,
        libraryStatus: 'idle',
      });
    } catch (err) {
      set({ libraryStatus: 'error', libraryError: friendlyMessage(err, 'Loading your library') });
    }
  },

  importMedia: async (paths) => {
    if (paths.length === 0) return;
    const userId = requireUserId();
    set({
      importQueue: paths.map((path) => ({
        path,
        name: fileName(path),
        mediaId: null,
        status: 'queued',
        error: null,
      })),
    });

    const created = await api.post<MediaItemOut[]>('/media/import', { user_id: userId, paths });
    set({
      importQueue: created.map((item, i) => ({
        path: paths[i] ?? item.source_path ?? '',
        name: item.title,
        mediaId: item.id,
        status: item.ingest_status,
        error: item.ingest_error,
      })),
    });
    await get().fetchLibrary();

    // Poll until nothing is mid-flight. Probing a two-hour MKV with three
    // subtitle tracks is not instant, and a card that silently sits at
    // "queued" forever reads as a hang.
    const pending = () => get().importQueue.filter((q) => q.status === 'queued' || q.status === 'probing');
    while (pending().length > 0) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const fresh = await Promise.all(
        pending().map(async (q) => {
          if (!q.mediaId) return null;
          try {
            const detail = await api.get<MediaDetailOut>(`/media/${q.mediaId}`);
            return { id: q.mediaId, status: detail.item.ingest_status, error: detail.item.ingest_error };
          } catch {
            return { id: q.mediaId, status: 'failed' as const, error: 'Could not read this file.' };
          }
        }),
      );
      set((state) => ({
        importQueue: state.importQueue.map((q) => {
          const update = fresh.find((f) => f && f.id === q.mediaId);
          return update ? { ...q, status: update.status, error: update.error } : q;
        }),
      }));
      await get().fetchLibrary();
    }
  },

  clearImportQueue: () => set({ importQueue: [] }),

  deleteMedia: async (mediaId) => {
    await api.delete(`/media/${mediaId}`);
    if (get().detail?.item.id === mediaId) get().closeMedia();
    await get().fetchLibrary();
  },

  renameMedia: async (mediaId, title) => {
    await api.patch<MediaItemOut>(`/media/${mediaId}`, { title });
    await get().fetchLibrary();
    if (get().detail?.item.id === mediaId) await get().refreshDetail();
  },

  relinkMedia: async (mediaId, path) => {
    await api.post<MediaItemOut>(`/media/${mediaId}/relink`, { path });
    await get().fetchLibrary();
    if (get().detail?.item.id === mediaId) await get().refreshDetail();
  },

  reingest: async (mediaId) => {
    await api.post<MediaItemOut>(`/media/${mediaId}/reingest`, {});
    await get().fetchLibrary();
  },

  /** Move an MP4's seek index to the front. Returns an error message, or null
   * on success. Polls because the remux runs as a background task and, on a
   * feature-length film, takes as long as the disk does. */
  optimizeForSeeking: async (mediaId) => {
    await api.post<MediaItemOut>(`/media/${mediaId}/optimize`, {});
    for (let attempt = 0; attempt < 900; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const fresh = await api.get<MediaDetailOut>(`/media/${mediaId}`);
      if (fresh.item.ingest_status === 'probing') continue;
      set({ detail: get().detail?.item.id === mediaId ? fresh : get().detail });
      await get().fetchLibrary();
      return fresh.item.index_at_end ? (fresh.item.ingest_error ?? 'Could not rewrite this file.') : null;
    }
    return 'This is taking longer than expected — check back shortly.';
  },

  openMedia: async (mediaId) => {
    set({ detailStatus: 'loading', detailError: null, targetCues: [], nativeCues: [] });
    try {
      const detail = await api.get<MediaDetailOut>(`/media/${mediaId}`);
      set({ detail, detailStatus: 'idle' });
      await Promise.all([
        detail.prefs.target_track_id ? get().loadCues(detail.prefs.target_track_id, 'target') : Promise.resolve(),
        detail.prefs.native_track_id ? get().loadCues(detail.prefs.native_track_id, 'native') : Promise.resolve(),
        get().fetchPlayerPrefs(),
        get().fetchClips(mediaId),
      ]);
    } catch (err) {
      set({ detailStatus: 'error', detailError: friendlyMessage(err, 'Opening this video') });
    }
  },

  closeMedia: () =>
    set({ detail: null, targetCues: [], nativeCues: [], clips: [], detailStatus: 'idle', detailError: null }),

  loadCues: async (trackId, role) => {
    const cues = await api.get<CueOut[]>(`/media/tracks/${trackId}/cues`);
    set(role === 'target' ? { targetCues: cues } : { nativeCues: cues });
  },

  setTrack: async (role, trackId) => {
    const detail = get().detail;
    if (!detail) return;
    await get().setItemPrefs(
      role === 'target' ? { target_track_id: trackId } : { native_track_id: trackId },
    );
    if (trackId) await get().loadCues(trackId, role);
    else set(role === 'target' ? { targetCues: [] } : { nativeCues: [] });
  },

  setItemPrefs: async (patch) => {
    const detail = get().detail;
    if (!detail) return;
    const prefs = await api.put<MediaItemPrefsOut>(`/media/${detail.item.id}/prefs`, patch);
    set({ detail: { ...detail, prefs } });
  },

  addSidecar: async (path, role) => {
    const detail = get().detail;
    if (!detail) return;
    const track = await api.post<MediaTrackOut>(`/media/${detail.item.id}/tracks/sidecar`, { path, role });
    await get().refreshDetail();
    await get().setTrack(role, track.id);
  },

  generateSubtitles: async () => {
    const detail = get().detail;
    if (!detail) return;
    const userId = requireUserId();
    const mediaId = detail.item.id;
    const track = await api.post<MediaTrackOut>(`/media/${mediaId}/tracks/generate`, {
      user_id: userId,
      language: 'en',
    });
    if (get().detail?.item.id === mediaId) await get().refreshDetail();

    // Cues arrive in batches while Whisper works, so this keeps refreshing
    // until the track stops moving — the player shows the transcript filling
    // in rather than a spinner over an empty screen.
    //
    // The job outlives the player, so every write is guarded on this item still
    // being the open one: transcribing in the background must not drag the
    // screen back off whatever the user opened next.
    let done = false;
    while (!done) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const fresh = await api.get<MediaDetailOut>(`/media/${mediaId}`);
      const current = fresh.tracks.find((t) => t.id === track.id);
      if (get().detail?.item.id === mediaId) {
        set({ detail: fresh });
        if (current && current.cue_count > 0 && get().detail?.prefs.target_track_id === track.id) {
          await get().loadCues(track.id, 'target');
        }
      }
      done = !current || current.status === 'ready' || current.status === 'failed';
      if (done && current?.status === 'ready') {
        // Selecting the finished track is a stored preference, so it still
        // happens when the user has moved on — just written straight to that
        // item rather than through the open one's state.
        if (get().detail?.item.id === mediaId) await get().setTrack('target', track.id);
        else await api.put<MediaItemPrefsOut>(`/media/${mediaId}/prefs`, { target_track_id: track.id });
      }
    }
    await get().fetchLibrary();
  },

  cancelGeneration: async (trackId) => {
    await api.post(`/media/tracks/${trackId}/cancel`, {});
  },

  deleteTrack: async (trackId) => {
    const detail = get().detail;
    if (!detail) return;
    await api.delete(`/media/tracks/${trackId}`);
    if (detail.prefs.target_track_id === trackId) set({ targetCues: [] });
    if (detail.prefs.native_track_id === trackId) set({ nativeCues: [] });
    await get().refreshDetail();
  },

  refreshDetail: async () => {
    const detail = get().detail;
    if (!detail) return;
    set({ detail: await api.get<MediaDetailOut>(`/media/${detail.item.id}`) });
  },

  fetchPlayerPrefs: async () => {
    const userId = requireUserId();
    set({ playerPrefs: await api.get<PlayerPrefsOut>(`/media/prefs/player?user_id=${encodeURIComponent(userId)}`) });
  },

  setPlayerPrefs: async (patch) => {
    const userId = requireUserId();
    const current = get().playerPrefs;
    // Applied locally first: these are toggles on top of playing video, and a
    // round trip before the subtitle blurs would feel broken.
    if (current) set({ playerPrefs: { ...current, ...patch } });
    const saved = await api.put<PlayerPrefsOut>(
      `/media/prefs/player?user_id=${encodeURIComponent(userId)}`,
      patch,
    );
    set({ playerPrefs: saved });
  },

  saveProgress: async (mediaId, positionMs, watchedDeltaMs) => {
    const userId = requireUserId();
    await api.put<ProgressOut>(`/media/${mediaId}/progress`, {
      user_id: userId,
      position_ms: Math.max(0, Math.round(positionMs)),
      watched_delta_ms: Math.max(0, Math.round(watchedDeltaMs)),
    });
  },

  saveWord: async (payload) => {
    const userId = requireUserId();
    const result = await api.post<SaveFromVideoOut>(`/media/${payload.mediaId}/save-word`, {
      user_id: userId,
      word: payload.word,
      cue_id: payload.cueId,
      cue_text: payload.cueText,
      start_ms: Math.max(0, Math.round(payload.startMs)),
      end_ms: Math.max(0, Math.round(payload.endMs)),
      pos: payload.pos ?? '',
      definition: payload.definition ?? '',
      example: payload.example ?? null,
      synonyms: payload.synonyms ?? [],
      ipa: payload.ipa ?? null,
      audio_url: payload.audioUrl ?? null,
      note: payload.note ?? null,
      ai_definition: payload.aiDefinition ?? null,
      ai_examples: payload.aiExamples ?? [],
      ai_mnemonic: payload.aiMnemonic ?? null,
      ai_usage_note: payload.aiUsageNote ?? null,
      ai_sense_definition: payload.aiSenseDefinition ?? null,
    });
    void get().fetchClips(payload.mediaId);
    return result;
  },

  fetchClips: async (mediaId) => {
    const userId = requireUserId();
    const params = new URLSearchParams({ user_id: userId });
    if (mediaId) params.set('media_id', mediaId);
    set({ clips: await api.get<ClipOut[]>(`/media/clips/list?${params.toString()}`) });
  },

  retryClip: async (clipId) => {
    const userId = requireUserId();
    await api.post<ClipOut>(`/media/clips/${clipId}/retry?user_id=${encodeURIComponent(userId)}`, {});
    await get().fetchClips(get().detail?.item.id);
  },

  deleteClip: async (clipId) => {
    // Removes the moment, not the word: the vocabulary entry and its own
    // scheduling survive a clip being thrown away.
    await api.delete(`/media/clips/${clipId}`);
    await get().fetchClips(get().detail?.item.id);
  },
}));

/** The cue covering `ms`, by binary search.
 *
 * Called on every timeupdate — four times a second per subtitle track — so a
 * linear scan over 1,500 cues would be 6,000 comparisons a second for no
 * reason. Returns -1 when the moment falls in a gap between cues, which is
 * most of a film and is not an error. */
export function cueIndexAt(cues: CueOut[], ms: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid];
    if (ms < cue.start_ms) hi = mid - 1;
    else if (ms > cue.end_ms) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** The cue at `ms`, or the one that most recently ended.
 *
 * The player needs this rather than cueIndexAt alone: "replay the last line"
 * and "what am I looking up" must keep working in the silence between cues,
 * which is where a learner most often pauses to ask. */
export function activeOrPreviousIndex(cues: CueOut[], ms: number): number {
  const exact = cueIndexAt(cues, ms);
  if (exact !== -1) return exact;
  let lo = 0;
  let hi = cues.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].end_ms <= ms) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
