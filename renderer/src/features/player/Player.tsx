import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SidePanel, type PanelTab } from '@/features/player/SidePanel';
import { SPEEDS, timecode } from '@/features/player/playerFormat';
import {
  Back5Icon,
  ExitFullscreenIcon,
  Forward5Icon,
  FullscreenIcon,
  MutedIcon,
  NextLineIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  PrevLineIcon,
  ReplayLineIcon,
  SavedIcon,
  SettingsIcon,
  VolumeIcon,
} from '@/features/player/PlayerIcons';
import { PlayerSettings } from '@/features/player/PlayerSettings';
import { SubtitleLayer } from '@/features/player/SubtitleLayer';
import { activeOrPreviousIndex, cueIndexAt, posterUrl, streamUrl, useMediaStore } from '@/store/mediaStore';
import { useShellStore } from '@/store/shellStore';
import type { CueOut } from '@/types/api';

/** How often playback position is written back. Every 5 s of real playback
 * rather than every timeupdate: resuming within five seconds of where you
 * stopped is indistinguishable from exact, and the alternative is ~240
 * database writes a minute per open file. */
const PROGRESS_INTERVAL_MS = 5000;
/** Volume lives in localStorage rather than the database for the same reason
 * the interface scale does: it describes this machine's speakers, not this
 * learner. Mute deliberately does NOT persist — opening the app to silence
 * with no memory of having muted it reads as broken audio. */
const VOLUME_KEY = 'fluencyos.playerVolume';

function storedVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    const value = raw === null ? 1 : Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  } catch {
    // Private windows and blocked site data throw on access.
    return 1;
  }
}
const SEEK_STEP_S = 5;
const FRAME_S = 1 / 24;

export function Player() {
  const mediaId = useShellStore((s) => s.nowPlayingId);
  const goScreen = useShellStore((s) => s.goScreen);
  const {
    detail,
    detailStatus,
    detailError,
    targetCues,
    nativeCues,
    playerPrefs,
    clips,
    openMedia,
    closeMedia,
    setPlayerPrefs,
    saveProgress,
    relinkMedia,
    optimizeForSeeking,
  } = useMediaStore();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Fullscreen is requested on the whole player, not on the video box, so the
  // lookup panel is inside the fullscreen element and can be shown over the
  // film. Requesting it on the video's parent — which is what this did — puts
  // the panel outside the fullscreen subtree, where the browser will not
  // render it at all.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const idleTimer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolume] = useState(storedVolume);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The picture cannot be decoded — see onLoadedMetadata.
  const [undecodable, setUndecodable] = useState(false);
  // Cleared when the file changes, so one undecodable item does not leave the
  // warning sitting over the next, perfectly playable, one.
  //
  // It has to live up here with the other hooks: this component early-returns
  // four times below (no media, loading, error, no detail), and a hook placed
  // after those runs on some renders and not others. React counts hooks per
  // render, so that mismatch throws and takes the whole screen with it — which
  // is exactly what it did.
  useEffect(() => setUndecodable(false), [mediaId]);

  const [lookup, setLookup] = useState<{ term: string; cue: CueOut | null } | null>(null);
  // null closes the panel. The lookup itself is kept either way, so reopening
  // the tab shows the last word rather than an empty panel.
  const [panelTab, setPanelTab] = useState<PanelTab | null>(null);
  const [toast, setToast] = useState('');
  const [scrubHover, setScrubHover] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeDismissed, setOptimizeDismissed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  // Watch time that is genuinely playback, not seeking. Accumulated from the
  // delta between consecutive timeupdates and discarded when that delta is
  // implausible, which is exactly what a seek produces.
  const watchedMs = useRef(0);
  const lastTick = useRef<number | null>(null);
  const lastFlush = useRef(0);
  // Playback position, mirrored out of the media element. Progress is flushed
  // on the way out of the screen, and by then React may already have detached
  // the ref — reading video.currentTime there loses the position entirely.
  const positionRef = useRef(0);
  // Whether positionRef holds a real position yet. Opening a file and leaving
  // before its metadata loads must not write 0 over where the learner actually
  // got to — losing a resume point is worse than not updating one.
  const positionKnown = useRef(false);
  const loopingCue = useRef<number | null>(null);
  /* The cue playback was inside on the previous tick.
   *
   * Auto-pause has to fire when a line ENDS. It used to look for a moment
   * with no cue at all, which assumes subtitles have silence between them —
   * and most do not. On this episode's track 421 of 423 consecutive pairs
   * touch exactly, so the next line began on the same millisecond the last
   * one ended, there was never a gap to notice, and auto-pause never fired
   * once. Watching for the cue to CHANGE works either way. */
  const lastCueIndex = useRef(-1);
  // The cue auto-pause last stopped on. Without this, pressing play inside the
  // gap it paused in re-triggers the same pause on the very next tick and the
  // learner cannot get out of it.
  const autoPausedAfter = useRef<number | null>(null);
  // Read by seekTo, which is created once and must still see today's cues.
  const targetCuesRef = useRef<CueOut[]>([]);
  const delayRef = useRef(0);

  useEffect(() => {
    positionKnown.current = false;
    positionRef.current = 0;
    if (mediaId) void openMedia(mediaId);
    return () => closeMedia();
  }, [mediaId, openMedia, closeMedia]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  // The browser can leave fullscreen without us (Esc, or the window losing it),
  // so the flag follows the document rather than our own button.
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // Controls stay put in the window and fade out in fullscreen, which is where
  // they cover the picture. Any mouse movement brings them back.
  useEffect(() => {
    if (!isFullscreen) {
      setChromeVisible(true);
      return;
    }
    const wake = () => {
      setChromeVisible(true);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setChromeVisible(false), 2600);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [isFullscreen]);

  const delayMs = detail?.prefs.subtitle_delay_ms ?? 0;
  targetCuesRef.current = targetCues;
  delayRef.current = delayMs;
  const cueTimeMs = positionMs - delayMs;

  const tickDuration = durationMs || detail?.item.duration_ms || 0;
  const cueTicks = useMemo(() => {
    if (targetCues.length === 0 || targetCues.length >= 4000 || tickDuration <= 0) return null;
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[7px] h-[4px] opacity-35 transition-opacity group-hover:opacity-100">
        {targetCues.map((cue) => (
          <span
            key={cue.id}
            className="absolute top-0 h-[4px] w-[1px] bg-white/55"
            style={{ left: `${(cue.start_ms / tickDuration) * 100}%` }}
          />
        ))}
      </div>
    );
  }, [targetCues, tickDuration]);

  /* What the subtitle switches have to work with.
   *
   * `dual` needs a second, native-language track; the other three need any
   * subtitles at all. Without them the switch cannot do its job, and showing
   * it live is worse than showing it off — it looks broken rather than
   * inapplicable. */
  const hasSubs = targetCues.length > 0;
  const hasNativeSubs = nativeCues.length > 0;
  const subsOn = playerPrefs?.subs_on !== false;
  const dualOn = Boolean(playerPrefs?.dual_subs) && hasNativeSubs;

  const targetIndex = useMemo(() => cueIndexAt(targetCues, cueTimeMs), [targetCues, cueTimeMs]);
  const nativeIndex = useMemo(() => cueIndexAt(nativeCues, cueTimeMs), [nativeCues, cueTimeMs]);
  const targetCue = targetIndex >= 0 ? targetCues[targetIndex] : null;
  const nativeCue = nativeIndex >= 0 ? nativeCues[nativeIndex] : null;

  const flushProgress = useCallback(
    (force = false) => {
      if (!mediaId || !detail || !positionKnown.current) return;
      const now = positionRef.current;
      if (!force && now - lastFlush.current < PROGRESS_INTERVAL_MS && watchedMs.current < PROGRESS_INTERVAL_MS) {
        return;
      }
      lastFlush.current = now;
      const delta = watchedMs.current;
      watchedMs.current = 0;
      void saveProgress(mediaId, now, delta).catch(() => {
        // Progress is a convenience; failing to record it must not interrupt
        // playback or throw inside a media event handler.
      });
    },
    [mediaId, detail, saveProgress],
  );

  // The last thing a session should do is remember where it stopped, so this
  // fires on unmount and on window close as well as on the interval.
  useEffect(() => {
    const onUnload = () => flushProgress(true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      flushProgress(true);
    };
  }, [flushProgress]);

  /** Ref callback rather than a plain ref, because detaching is the event we
   * need and a plain ref gives no notice of it.
   *
   * Taking a <video> out of the document does NOT cancel its fetch. Chromium
   * keeps the resource loader alive and carries on pulling byte ranges for a
   * file nobody is watching — which is what filled the backend log with
   * /stream requests long after leaving the player, and left the audio
   * running. Clearing src and re-running load() is the documented way to make
   * a media element let go of its resource.
   *
   * useCallback with no deps is load-bearing: an inline ref callback is a new
   * function every render, so React would detach and re-attach — tearing the
   * video down — on each one. */
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    if (element) {
      videoRef.current = element;
      return;
    }
    const previous = videoRef.current;
    videoRef.current = null;
    if (!previous) return;
    previous.pause();
    previous.removeAttribute('src');
    previous.load();
  }, []);

  /** `armAutoPause` is false for a scrub or a ±5s jump: the learner moved
   * there to watch, and stopping them two seconds later — with no visible
   * reason — reads as the video refusing to play rather than as a feature.
   * Line navigation and replay-line keep it armed, because pausing at the end
   * of the line you asked for is the point of those. */
  // Apply volume and mute to the media element.
  //
  // This is what was missing: `volume` and `muted` were React state that
  // moved the slider and swapped the icon but never touched the <video>, so
  // the sound controls did nothing at all. Everything else the player sets on
  // the element — playbackRate, preservesPitch — is applied in
  // onLoadedMetadata; these two also have to follow later changes, hence an
  // effect rather than a one-off.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    try {
      window.localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Not being able to remember the level is not worth failing over.
    }
  }, [volume, muted, detail]);

  const seekTo = useCallback(
    (
      ms: number,
      { armAutoPause = true, keepLoop = false }: { armAutoPause?: boolean; keepLoop?: boolean } = {},
    ) => {
      const video = videoRef.current;
      if (!video) return;
      const target = Math.max(0, ms / 1000);
      video.currentTime = target;
      positionRef.current = target * 1000;
      lastTick.current = null;
      // Moving somewhere deliberately chooses a new line to repeat. Only the
      // loop's own rewind keeps the line it had locked.
      if (!keepLoop) loopingCue.current = null;
      if (!armAutoPause) {
        // Mark the cue we landed in as already handled, so its end passes
        // without a pause. The next line pauses normally.
        autoPausedAfter.current = activeOrPreviousIndex(targetCuesRef.current, target * 1000 - delayRef.current);
      }
    },
    [],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  /** Spec §4.1.1: replay the current line. The "or previous" lookup is what
   * makes it work in the gap between cues, which is where it is pressed. */
  const replayLine = useCallback(() => {
    const index = activeOrPreviousIndex(targetCues, cueTimeMs);
    if (index < 0) return;
    seekTo(targetCues[index].start_ms + delayMs);
    void videoRef.current?.play();
  }, [targetCues, cueTimeMs, delayMs, seekTo]);

  const jumpCue = useCallback(
    (direction: 1 | -1) => {
      const index = activeOrPreviousIndex(targetCues, cueTimeMs);
      const next = index + direction;
      if (next < 0 || next >= targetCues.length) return;
      seekTo(targetCues[next].start_ms + delayMs);
    },
    [targetCues, cueTimeMs, delayMs, seekTo],
  );

  const togglePref = useCallback(
    (key: 'subs_on' | 'dual_subs' | 'blur_subs' | 'auto_pause' | 'loop_cue') => {
      if (!playerPrefs) return;
      void setPlayerPrefs({ [key]: !playerPrefs[key] });
    },
    [playerPrefs, setPlayerPrefs],
  );

  /** The same switch from the keyboard, where there is no dimmed button to
   * see — so the reason has to be said out loud. */
  const guardedTogglePref = useCallback(
    (key: 'subs_on' | 'dual_subs' | 'auto_pause' | 'loop_cue') => {
      const needsNative = key === 'dual_subs';
      if (needsNative ? !hasNativeSubs : !hasSubs) {
        setToast(unavailableReason(needsNative));
        return;
      }
      if (key === 'dual_subs' && !subsOn) {
        setToast('subtitles are hidden — press S to bring them back');
        return;
      }
      togglePref(key);
    },
    [hasNativeSubs, hasSubs, subsOn, togglePref],
  );

  // Keyboard shortcuts (spec §4.1.1). Bound to the window rather than the
  // video element: the video only has focus until the learner clicks a
  // subtitle word, and space must keep working after that.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      const handlers: Record<string, () => void> = {
        ' ': togglePlay,
        k: togglePlay,
        ArrowRight: () => seekTo((video.currentTime + SEEK_STEP_S) * 1000, { armAutoPause: false }),
        ArrowLeft: () => seekTo((video.currentTime - SEEK_STEP_S) * 1000, { armAutoPause: false }),
        ArrowUp: () => setVolume((v) => Math.min(1, v + 0.05)),
        ArrowDown: () => setVolume((v) => Math.max(0, v - 0.05)),
        a: replayLine,
        n: () => jumpCue(1),
        p: () => jumpCue(-1),
        s: () => guardedTogglePref('subs_on'),
        b: () => togglePref('blur_subs'),
        l: () => guardedTogglePref('loop_cue'),
        o: () => guardedTogglePref('auto_pause'),
        d: () => guardedTogglePref('dual_subs'),
        m: () => setMuted((v) => !v),
        f: () => void toggleFullscreen(),
        ',': () => seekTo((video.currentTime - FRAME_S) * 1000),
        '.': () => seekTo((video.currentTime + FRAME_S) * 1000),
        Escape: () => setPanelTab(null),
      };
      const handler = handlers[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekTo, replayLine, jumpCue, togglePref, guardedTogglePref]);

  const toggleFullscreen = async () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen().catch(() => undefined);
  };

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      setToast('picture-in-picture is unavailable for this file');
    }
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const nowMs = video.currentTime * 1000;
    positionRef.current = nowMs;
    positionKnown.current = true;
    setPositionMs(nowMs);

    if (lastTick.current !== null) {
      const delta = nowMs - lastTick.current;
      // A plausible tick is forward and no larger than a couple of frames at
      // 2x. Anything else is a seek, and counting it would make "time watched"
      // a measure of scrubbing.
      if (delta > 0 && delta < 1000) watchedMs.current += delta;
    }
    lastTick.current = nowMs;

    const cueMs = nowMs - delayMs;
    const index = cueIndexAt(targetCues, cueMs);

    const leaving = lastCueIndex.current;

    if (playerPrefs?.loop_cue) {
      /* Locked onto one line and kept there.
       *
       * This used to re-lock onto whatever cue playback was inside, on every
       * tick. Where subtitles run back to back that moved the lock to the
       * next line the instant the current one ended — so the end of the
       * locked line was never reached, and loop did nothing at all. The lock
       * is now taken once and only released by a deliberate seek. */
      if (loopingCue.current === null && index >= 0) loopingCue.current = index;
      const looping = loopingCue.current;
      if (looping !== null && looping < targetCues.length && cueMs >= targetCues[looping].end_ms) {
        seekTo(targetCues[looping].start_ms + delayMs, { armAutoPause: false, keepLoop: true });
        lastCueIndex.current = looping;
        return;
      }
    } else if (loopingCue.current !== null) {
      loopingCue.current = null;
    }

    if (
      playerPrefs?.auto_pause &&
      !video.paused &&
      leaving >= 0 &&
      index !== leaving &&
      // One pause per line: without this, resuming pauses again immediately.
      autoPausedAfter.current !== leaving
    ) {
      // Wound back to where the line actually ended. A tick lands up to a
      // quarter of a second late, so pausing where we noticed would start the
      // next line already part-said.
      video.currentTime = (targetCues[leaving].end_ms + delayMs) / 1000;
      positionRef.current = targetCues[leaving].end_ms + delayMs;
      lastTick.current = null;
      video.pause();
      autoPausedAfter.current = leaving;
      setAutoPaused(true);
      lastCueIndex.current = leaving;
      flushProgress();
      return;
    }

    lastCueIndex.current = index;

    flushProgress();
  };

  const onSelectText = (text: string, cue: CueOut) => {
    videoRef.current?.pause();
    setLookup({ term: text, cue });
    setPanelTab('lookup');
    // Clicking a word is the one moment the panel must be on screen, whether
    // or not we are fullscreen — that is the whole point of the gesture.
    setChromeVisible(true);
  };

  const relink = async () => {
    if (!mediaId) return;
    const paths = await window.fluencyos.pickMediaFiles();
    if (paths.length === 0) return;
    await relinkMedia(mediaId, paths[0]);
    setVideoError(null);
  };

  if (!mediaId) {
    return (
      <Centered>
        <p className="font-sans text-[13px] text-tx2">Nothing is open yet.</p>
        <button
          onClick={() => goScreen('library')}
          className="mt-3 rounded-field bg-accSolid px-[14px] py-2 font-sans text-[11.5px] font-semibold text-white"
        >
          Open the library
        </button>
      </Centered>
    );
  }

  if (detailStatus === 'loading' && !detail) return <Centered>loading…</Centered>;
  if (detailStatus === 'error') return <Centered>{detailError}</Centered>;
  if (!detail) return <Centered>loading…</Centered>;

  const item = detail.item;
  const missing = item.source_missing;
  const subtitleTracks = detail.tracks.filter((t) => t.kind === 'subtitle');
  const generating = subtitleTracks.find((t) => t.status === 'transcribing' || t.status === 'queued');

  return (
    <div ref={rootRef} className="relative flex h-full w-full min-h-0 bg-[#08090a]">
      <div className="flex min-w-0 flex-1 flex-col bg-[#08090a]">
        <div className="relative grid min-h-0 flex-1 place-items-center bg-black">
          {missing ? (
            <div className="max-w-[420px] px-6 text-center">
              <div className="font-sans text-[13px] font-semibold text-white">This file has moved.</div>
              <div className="mt-2 font-mono text-[11px] leading-[1.7] text-white/50">{item.source_path}</div>
              <div className="mt-3 font-sans text-[11.5px] leading-[1.6] text-white/60">
                Your saved words and clips from it are safe — point FluencyOS at the file’s new location to keep
                watching.
              </div>
              <button
                onClick={() => void relink()}
                className="mt-[14px] rounded-field bg-accSolid px-[14px] py-2 font-sans text-[11.5px] font-semibold text-white"
              >
                Locate the file…
              </button>
            </div>
          ) : (
            <video
              ref={attachVideo}
              src={streamUrl(item.id)}
              poster={item.has_thumbnail ? posterUrl(item.id) : undefined}
              // Without this Chromium downloads the entire file the moment the
              // screen opens, whether or not anyone presses play — a 2 GB read
              // for a glance at the library. Buffering ahead during playback is
              // unaffected; preload only governs what happens before it.
              preload="metadata"
              /* Pinned to the box rather than sized by it.
               *
               * `h-full` does nothing here: the picture area centres its
               * children, so the video is not stretched and its height
               * resolves against an indefinite row — which sends it back to
               * its own aspect ratio, WIDTH x 9/16. In a small window that
               * happens to come out shorter than the space available and
               * everything looks right. Widen the window and it does not:
               * at 1858px across the video computed 1045px tall inside a
               * 933px column, overflowed the bottom of it, and covered the
               * transport bar completely. Maximising the window lost the
               * controls.
               *
               * Positioned, the box is the picture area exactly, at every
               * window size, and object-fit letterboxes inside it. */
              className="absolute inset-0 h-full w-full bg-black object-contain"
              onClick={togglePlay}
              onDoubleClick={() => void toggleFullscreen()}
              onLoadedMetadata={(e) => {
                const video = e.currentTarget;
                /* A video track Chromium cannot decode reports NO error at all.
                 *
                 * Measured on an HEVC file: readyState reaches 4, currentTime
                 * advances, the AAC audio plays — and videoWidth stays 0 with
                 * totalVideoFrames stuck at 0, because not one frame was ever
                 * decoded. On screen that is a frozen picture with sound and a
                 * running clock, which reads as the app being broken rather
                 * than as the file being in a format it cannot open. Nothing
                 * fires to say so, so it has to be noticed here. */
                setUndecodable(video.videoWidth === 0 && video.videoHeight === 0);
                setDurationMs(video.duration * 1000);
                video.playbackRate = rate;
                // Chromium keeps pitch correction on by default, but it is the
                // whole point of slowing a film down to listen, so it is set
                // explicitly rather than inherited.
                video.preservesPitch = true;
                video.volume = volume;
                video.muted = muted;
                positionRef.current = video.currentTime * 1000;
                positionKnown.current = true;
                if (!resumed && (item.position_ms ?? 0) > 0) {
                  // Half a second back, so resuming lands just before the word
                  // that was on screen rather than just after it.
                  const resumeAt = Math.max(0, (item.position_ms! - 500) / 1000);
                  video.currentTime = resumeAt;
                  positionRef.current = resumeAt * 1000;
                  setResumed(true);
                }
              }}
              onTimeUpdate={onTimeUpdate}
              onPlay={() => {
                setPlaying(true);
                setAutoPaused(false);
              }}
              onPause={() => {
                setPlaying(false);
                lastTick.current = null;
                flushProgress(true);
              }}
              onEnded={() => flushProgress(true)}
              onError={() =>
                setVideoError(
                  'FluencyOS can’t open this file. It plays MP4, M4V and WebM videos — files ending ' +
                    'in .mkv, .avi, .wmv, .flv or .mpg can’t be opened at all, whatever is inside ' +
                    'them. Converting one to MP4 usually takes seconds and loses no quality.',
                )
              }
            />
          )}

          {videoError && (
            <div className="absolute inset-x-0 top-1/2 mx-auto max-w-[430px] -translate-y-1/2 rounded-panel bg-black/85 px-5 py-4 text-center">
              <div className="font-sans text-[12.5px] leading-[1.6] text-white/85">{videoError}</div>
              <div className="mt-[10px] font-mono text-[9.5px] leading-[1.6] text-white/45">
                if you’re comfortable with a terminal:
              </div>
              <code className="mt-[5px] block select-text rounded-field border border-white/15 bg-black/60 px-[10px] py-[7px] text-left font-mono text-[10px] leading-[1.6] text-white/75">
                ffmpeg -i input.mkv -c copy output.mp4
              </code>
              <div className="mt-[10px] font-mono text-[9.5px] text-white/40">
                this file: {item.video_codec ?? 'unknown'} · {item.audio_codec ?? 'unknown'} ·{' '}
                {item.container ?? 'unknown'}
              </div>
            </div>
          )}

          <div className="absolute left-4 top-[14px] flex items-center gap-[6px]">
            <button
              onClick={() => {
                flushProgress(true);
                goScreen('library');
              }}
              className="rounded-[4px] bg-black/45 px-[9px] py-1 font-mono text-[9.5px] font-medium text-white/70 hover:bg-black/70 hover:text-white"
            >
              ‹ library
            </button>
            <span className="max-w-[320px] truncate rounded-[4px] bg-black/45 px-2 py-1 font-mono text-[9.5px] font-medium text-white/50">
              {item.title}
            </span>
{/* The subtitle switch.
                 *
                 * This read "subs on" and was only ever a label — it reported
                 * a state with no way to change it, and listening without the
                 * text is the harder half of the exercise. Turning them off
                 * used to mean unsetting the whole track, which forgot which
                 * track had been chosen. */}
            {hasSubs && (
              <button
                onClick={() => togglePref('subs_on')}
                title={subsOn ? 'Hide the subtitles  (S)' : 'Show the subtitles  (S)'}
                aria-pressed={subsOn}
                className="rounded-[4px] px-2 py-1 font-mono text-[9.5px] font-medium transition-colors"
                style={{
                  background: subsOn ? 'rgba(var(--accRGB),.22)' : 'rgba(0,0,0,.45)',
                  color: subsOn ? 'var(--acc)' : 'rgba(255,255,255,.5)',
                }}
              >
                {!subsOn ? 'subs off' : dualOn ? 'dual subs' : 'subs on'}
              </button>
            )}
            {generating && (
              <span className="rounded-[4px] bg-black/45 px-2 py-1 font-mono text-[9.5px] font-medium text-white/70">
                transcribing {Math.round((generating.progress ?? 0) * 100)}%
              </span>
            )}
          </div>

          {undecodable && (
            <div className="absolute inset-0 grid place-items-center bg-black/80 p-6">
              <div className="max-w-[440px] text-center">
                <div className="font-sans text-[14px] font-semibold text-white">
                  The sound plays, but this picture can’t be decoded
                </div>
                <p className="mt-[8px] font-sans text-[12.5px] leading-[1.65] text-white/70">
                  The sound is playing but the picture isn’t — that’s why you can hear it while the
                  frame stays still and the clock keeps running. This video was saved in a format
                  this computer has no way to display, either because it’s an unusual older one or
                  because the graphics card doesn’t handle it.
                </p>
                <p className="mt-[10px] font-sans text-[12px] leading-[1.65] text-white/55">
                  Converting the picture fixes it, and leaves the sound exactly as it is. If you’re
                  comfortable with a terminal:
                </p>
                <code className="mt-[7px] block select-text rounded-field border border-white/15 bg-black/60 px-[10px] py-[8px] text-left font-mono text-[10px] leading-[1.6] text-white/80">
                  ffmpeg -i input.mp4 -c:v libx264 -crf 20 -c:a copy output.mp4
                </code>
              </div>
            </div>
          )}

          {!missing && !undecodable && targetCues.length === 0 && (
            <div className="absolute inset-x-0 bottom-[90px] mx-auto w-fit rounded-panel bg-black/70 px-4 py-[10px] text-center">
              <div className="font-sans text-[12px] text-white/80">No subtitles for this file yet.</div>
              <button
                onClick={() => setSettingsOpen(true)}
                className="mt-[7px] rounded-field border border-white/25 px-[11px] py-[5px] font-mono text-[10.5px] text-white/80 hover:border-acc hover:text-acc"
              >
                load or generate a track
              </button>
            </div>
          )}

          {item.index_at_end && !optimizeDismissed && !missing && (
            <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-3 bg-black/80 px-4 py-[10px]">
              <span className="min-w-0 flex-1 font-sans text-[11.5px] leading-[1.55] text-white/80">
                <strong className="font-semibold text-white">Seeking in this file is slow.</strong> Its index sits
                at the end, so jumping to a timestamp means reading the end of the file first — in any player.
                FluencyOS can move the index to the front without re-encoding: same picture, same audio, same size.
              </span>
              <button
                onClick={async () => {
                  setOptimizing(true);
                  const problem = await optimizeForSeeking(item.id);
                  setOptimizing(false);
                  setToast(problem ?? 'index moved to the front — seeking should be quick now');
                  if (!problem) setOptimizeDismissed(true);
                }}
                disabled={optimizing}
                className="flex-none rounded-field bg-accSolid px-[13px] py-[6px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
              >
                {optimizing ? 'rewriting…' : 'Fix seeking'}
              </button>
              <button
                onClick={() => setOptimizeDismissed(true)}
                className="flex-none font-mono text-[10.5px] text-white/45 hover:text-white/80"
              >
                not now
              </button>
            </div>
          )}

          {autoPaused && (
            <button
              onClick={togglePlay}
              className="absolute left-1/2 top-[18px] flex -translate-x-1/2 items-center gap-[7px] rounded-full bg-black/75 px-[13px] py-[6px] font-sans text-[11.5px] font-medium text-white/90 hover:bg-black/90"
            >
              <PauseIcon size={12} />
              paused at the end of the line — press space to carry on
            </button>
          )}

          {!missing && playerPrefs && subsOn && (
            <SubtitleLayer
              cue={targetCue}
              nativeCue={nativeCue}
              dualSubs={playerPrefs.dual_subs}
              blur={playerPrefs.blur_subs}
              // A fullscreen picture is several times the windowed one, so the
              // learner's chosen size is a size for the window and has to grow
              // with it — otherwise the setting means "unreadable" fullscreen.
              size={isFullscreen ? Math.round(playerPrefs.sub_size * 1.5) : playerPrefs.sub_size}
              opacity={playerPrefs.sub_opacity}
              // In fullscreen the transport bar floats over the bottom of the
              // picture rather than sitting below it, so the subtitle has to
              // step out of its way while it is on screen.
              offset={playerPrefs.sub_offset + (isFullscreen && chromeVisible ? 72 : 0)}
              insetRight={isFullscreen && panelTab ? 360 : 0}
              selectedWord={lookup?.term ?? null}
              onSelect={onSelectText}
            />
          )}
        </div>

        {/* Transport. Three groups, left to right: moving through the film,
            what is happening to the subtitles, and how it is being played.
            Previously one undifferentiated row of fifteen controls. */}
        <div
          className="flex-none border-t border-white/10 bg-[#0c0d0f] px-4 pb-[10px] pt-[6px] transition-opacity duration-200"
          style={{
            opacity: chromeVisible ? 1 : 0,
            pointerEvents: chromeVisible ? 'auto' : 'none',
            position: isFullscreen ? 'absolute' : undefined,
            insetInline: isFullscreen ? 0 : undefined,
            bottom: isFullscreen ? 0 : undefined,
            zIndex: isFullscreen ? 30 : undefined,
            background: isFullscreen
              ? 'linear-gradient(to top, rgba(8,9,10,.96), rgba(8,9,10,.72) 60%, transparent)'
              : undefined,
            borderTop: isFullscreen ? 'none' : undefined,
          }}
        >
          {/* Seek bar. Tall enough to hit: the hit area is 18px while the
              track stays 4px, so the bar looks thin and behaves thick. */}
          <div
            className="group relative h-[18px] cursor-pointer"
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setScrubHover(((e.clientX - box.left) / box.width) * (durationMs || item.duration_ms));
            }}
            onMouseLeave={() => setScrubHover(null)}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              seekTo(((e.clientX - box.left) / box.width) * (durationMs || item.duration_ms), {
                armAutoPause: false,
              });
            }}
          >
            <div className="absolute inset-x-0 top-[7px] h-[4px] rounded-full bg-white/18">
              <div
                className="h-[4px] rounded-full bg-acc"
                style={{ width: `${((positionMs / (durationMs || item.duration_ms || 1)) * 100).toFixed(2)}%` }}
              />
            </div>
            {/* Every cue as a tick: the bar becomes a map of where the dialogue
                is, which is what a learner is actually navigating.

                Memoised because the position updates four times a second and
                these do not move. Rebuilt inline, a generated track's ~300
                ticks were ~1,200 DOM reconciliations a second for a picture
                that never changed — and the count scales with film length. */}
            {cueTicks}
            <span
              className="pointer-events-none absolute top-[4px] h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-acc opacity-0 shadow-[0_0_0_3px_rgba(0,0,0,.35)] transition-opacity group-hover:opacity-100"
              style={{ left: `${((positionMs / (durationMs || item.duration_ms || 1)) * 100).toFixed(2)}%` }}
            />
            {scrubHover !== null && (
              <span
                className="pointer-events-none absolute -top-[21px] -translate-x-1/2 rounded-[4px] bg-black/90 px-[7px] py-[3px] font-mono text-[10.5px] tabular-nums text-white"
                style={{ left: `${(scrubHover / (durationMs || item.duration_ms || 1)) * 100}%` }}
              >
                {timecode(scrubHover)}
              </span>
            )}
          </div>

          <div className="mt-[4px] flex flex-nowrap items-center gap-[14px] overflow-x-auto">
            {/* moving through the film */}
            <div className="flex flex-none items-center gap-[3px]">
              <IconButton onClick={togglePlay} title={playing ? 'Pause  (space)' : 'Play  (space)'} primary>
                {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
              </IconButton>
              <IconButton
                onClick={() => seekTo(positionMs - SEEK_STEP_S * 1000, { armAutoPause: false })}
                title="Back 5 seconds  (←)"
              >
                <Back5Icon />
              </IconButton>
              <IconButton
                onClick={() => seekTo(positionMs + SEEK_STEP_S * 1000, { armAutoPause: false })}
                title="Forward 5 seconds  (→)"
              >
                <Forward5Icon />
              </IconButton>
            </div>

            <Divider />

            {/* moving line by line — the part that is specific to learning */}
            <div className="flex flex-none items-center gap-[3px]">
              <IconButton onClick={() => jumpCue(-1)} title="Previous line  (P)">
                <PrevLineIcon />
              </IconButton>
              <TextButton onClick={replayLine} title="Replay this line  (A)">
                <ReplayLineIcon size={13} />
                <span>replay line</span>
              </TextButton>
              <IconButton onClick={() => jumpCue(1)} title="Next line  (N)">
                <NextLineIcon />
              </IconButton>
            </div>

            <span className="flex-none font-mono text-[11.5px] tabular-nums text-white/75">
              {timecode(positionMs)}
              <span className="text-white/35"> / {timecode(durationMs || item.duration_ms)}</span>
            </span>

            <div className="min-w-[8px] flex-1" />

            {/* what is happening to the subtitles */}
            <div className="flex flex-none items-center gap-[5px]">
              {(
                [
                  ['dual_subs', 'dual', 'Show the native-language line too  (D)'],
                  ['blur_subs', 'blur', 'Hide subtitles until you hover them  (B)'],
                  ['auto_pause', 'auto-pause', 'Pause when each line ends  (O)'],
                  ['loop_cue', 'loop', 'Repeat the current line  (L)'],
                ] as const
              ).map(([key, label, title]) => {
                const needsNative = key === 'dual_subs';
                /* `dual` and `blur` describe how the subtitle text is drawn,
                 * so both are meaningless once it is not being drawn. The
                 * other two follow the cues rather than the text and still
                 * work with subtitles hidden — which is the point of listening
                 * without them. */
                const needsText = key === 'dual_subs' || key === 'blur_subs';
                const off =
                  (needsNative ? !hasNativeSubs : !hasSubs) || (needsText && !subsOn);
                return (
                  <Toggle
                    key={key}
                    on={Boolean(playerPrefs?.[key]) && !off}
                    disabled={off}
                    onClick={() => togglePref(key)}
                    label={label}
                    title={
                      off
                        ? needsText && !subsOn && hasSubs
                          ? 'subtitles are hidden — turn them back on first'
                          : unavailableReason(needsNative)
                        : title
                    }
                  />
                );
              })}
            </div>

            <Divider />

            {/* how it is being played */}
            <div className="flex flex-none items-center gap-[7px]">
              <label className="flex items-center gap-[5px]">
                <span className="sr-only">Playback speed</span>
                <select
                  value={rate}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setRate(next);
                    if (videoRef.current) videoRef.current.playbackRate = next;
                  }}
                  title="Playback speed — pitch is corrected, so slowing down does not deepen voices"
                  className="rounded-[5px] border border-white/15 bg-transparent py-[4px] pl-[7px] pr-[4px] font-mono text-[11px] text-white/80 outline-none hover:border-white/35"
                >
                  {SPEEDS.map((speed) => (
                    <option key={speed} value={speed} className="bg-[#0c0d0f]">
                      {speed}×
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-[5px]">
                <IconButton onClick={() => setMuted((v) => !v)} title={muted ? 'Unmute  (M)' : 'Mute  (M)'}>
                  {muted || volume === 0 ? <MutedIcon size={14} /> : <VolumeIcon size={14} />}
                </IconButton>
                <input
                  type="range"
                  aria-label="Volume"
                  min={0}
                  max={1}
                  step={0.02}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    setVolume(Number(e.target.value));
                    setMuted(false);
                  }}
                  className="h-[3px] w-[64px] accent-[var(--acc)]"
                />
              </div>

              <TextButton
                onClick={() => setPanelTab((current) => (current === 'saved' ? null : 'saved'))}
                title="Words saved from this file"
              >
                <SavedIcon size={13} />
                <span>saved</span>
                {clips.length > 0 && (
                  <span className="rounded-full bg-white/15 px-[5px] font-mono text-[9.5px] leading-[15px]">
                    {clips.length}
                  </span>
                )}
              </TextButton>

              <IconButton onClick={() => void togglePip()} title="Picture in picture">
                <PipIcon size={14} />
              </IconButton>
              <IconButton onClick={() => void toggleFullscreen()} title="Fullscreen  (F)">
                {isFullscreen ? <ExitFullscreenIcon size={14} /> : <FullscreenIcon size={14} />}
              </IconButton>
              <IconButton onClick={() => setSettingsOpen(true)} title="Subtitles, tracks and clips">
                <SettingsIcon size={14} />
              </IconButton>
            </div>
          </div>
        </div>

      </div>

      {panelTab && (
        <div
          className={
            isFullscreen
              ? 'absolute inset-y-0 right-0 z-40 flex w-[360px] max-w-[42vw] shadow-[0_0_60px_rgba(0,0,0,.55)]'
              : 'flex w-[340px] flex-none'
          }
        >
          <SidePanel
            mediaId={item.id}
            tab={panelTab}
            lookup={lookup}
            onTab={setPanelTab}
            onClose={() => setPanelTab(null)}
            onJump={(ms) => seekTo(ms, { armAutoPause: false })}
            onSaved={(message) => setToast(message)}
          />
        </div>
      )}

      {settingsOpen && <PlayerSettings onClose={() => setSettingsOpen(false)} />}

      {toast && (
        <div className="pointer-events-none absolute bottom-[96px] left-1/2 -translate-x-1/2 rounded-field bg-black/85 px-[14px] py-[9px] font-mono text-[11px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full w-full place-items-center bg-[#08090a] text-center text-tx3">{children}</div>;
}

/** Square icon button. 28px is the smallest target that stays comfortable in
 * a bar this dense; the play button is larger because it is pressed most. */
function IconButton({
  onClick,
  title,
  primary = false,
  children,
}: {
  onClick: () => void;
  title: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`grid flex-none place-items-center rounded-[5px] text-white/80 transition-colors hover:bg-white/10 hover:text-white ${
        primary ? 'h-[32px] w-[34px] bg-white/10' : 'h-[28px] w-[28px]'
      }`}
    >
      {children}
    </button>
  );
}

/** Icon plus a word. Used only for "replay line", which has no conventional
 * symbol and is the one control specific to this app rather than to players
 * in general — so it is the one that earns a label. */
function TextButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-[28px] flex-none items-center gap-[5px] whitespace-nowrap rounded-[5px] px-[9px] font-sans text-[11.5px] font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="h-[18px] w-px flex-none bg-white/12" />;
}

function unavailableReason(needsNative: boolean): string {
  return needsNative
    ? 'no native-language subtitles for this video — add a second track under Subtitles'
    : 'no subtitles for this video yet — add or generate a track under Subtitles';
}

function Toggle({
  on,
  onClick,
  label,
  title,
  disabled = false,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title: string;
  /** Nothing for this switch to act on — no native track to show, or no
   * subtitles at all. Dimmed and inert, with the reason in the tooltip,
   * rather than looking live and silently doing nothing. */
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className="h-[26px] flex-none whitespace-nowrap rounded-full border px-[11px] font-sans text-[11px] font-medium transition-colors disabled:cursor-default"
      style={{
        borderColor: on ? 'var(--accLine)' : 'rgba(255,255,255,.16)',
        background: on ? 'rgba(var(--accRGB),.22)' : 'transparent',
        color: on ? 'var(--acc)' : 'rgba(255,255,255,.62)',
        opacity: disabled ? 0.38 : 1,
      }}
    >
      {label}
    </button>
  );
}
