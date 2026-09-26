import { useCallback, useEffect, useRef, useState } from 'react';

const ORIGIN = 'https://www.youtube-nocookie.com';

/** How often to re-offer the handshake, and for how long before giving up. */
const HELLO_EVERY_MS = 350;
const HELLO_TIMEOUT_MS = 9000;

/** YouTube player states, as sent in infoDelivery. */
const UNSTARTED = -1;
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;

/** A YouTube scene the learner can watch but not steer.
 *
 * The embed is loaded with controls=0, which is the only way to remove the
 * title and channel name — they are player chrome, and an embed with controls
 * captions the scene with its own subject before the learner has described it.
 * With no controls there is nothing to click, so playback is driven over
 * postMessage instead, and this component supplies the two buttons the task
 * actually needs.
 *
 * A transparent sheet covers the iframe. Without it the player still answers
 * clicks — play/pause, the context menu, and on some videos a channel link —
 * all of which lead out of the ten seconds the challenge is about.
 *
 * No YouTube script is loaded: enablejsapi=1 makes the player accept commands
 * by postMessage on its own, so the page's script-src stays 'self'.
 *
 * **The handshake is the fiddly part.** The player ignores every command until
 * it has been told someone is listening, and it only hears that once its own
 * document has loaded. This used to be a single `listening` message on a fixed
 * 900ms timer, which is a race the frame loses often — measured at one attempt
 * in three on a warm cache. When it lost, the message went nowhere, the player
 * never registered us, `playVideo` did nothing, and the learner sat in front of
 * a black rectangle that the interface was cheerfully describing as playing.
 * Most of what got reported as "this video is gone" was this. So: the greeting
 * repeats until the player answers, playback waits for that answer rather than
 * assuming it, and a player that never answers is reported as unplayable
 * instead of being left on screen.
 */
export function SceneEmbed({
  src,
  startS,
  durationS,
  onPlayed,
  onUnplayable,
}: {
  src: string;
  /** The second the scene begins at inside the full video.
   *
   * The embed URL carries `start`, but that only applies to the initial load —
   * it is not a boundary the player keeps. Replaying therefore has to seek to
   * this explicitly. Seeking to 0 instead, which is what this did, jumped to
   * the beginning of the whole video and played ten seconds of whatever was
   * there: usually an intro, which is where the "random background music over a
   * black frame" came from. `end` does not re-apply after a seek either, which
   * is what the stop timer below is for. */
  startS: number;
  durationS: number;
  onPlayed?: () => void;
  /** The video will not play — the player said so, or never said anything.
   * About one VATEX video in five has genuinely been deleted or made private
   * since the corpus was collected. */
  onUnplayable?: (reason: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const stopTimer = useRef<number | null>(null);
  const helloTimer = useRef<number | null>(null);
  const giveUpTimer = useRef<number | null>(null);
  /** The player has answered at least once, so commands will be heard. */
  const readyRef = useRef(false);
  /** Play was pressed before the player was ready; run it when it is. */
  const wantPlayRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [watched, setWatched] = useState(false);

  // Held in refs so the message listener is attached once rather than torn down
  // and rebuilt every time the parent re-renders with a new callback.
  const onUnplayableRef = useRef(onUnplayable);
  onUnplayableRef.current = onUnplayable;
  const onPlayedRef = useRef(onPlayed);
  onPlayedRef.current = onPlayed;
  const durationRef = useRef(durationS);
  durationRef.current = durationS;
  const startRef = useRef(startS);
  startRef.current = startS;
  /** One report per scene. Errors arrive in bursts, and each one used to start
   * a fresh round — several at once, racing each other. */
  const reportedRef = useRef(false);

  const send = useCallback((func: string, args: unknown[] = []) => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      ORIGIN,
    );
  }, []);

  /** cc_load_policy=0 asks for captions off and does not get it — auto-captions
   * still burn over the picture ("[Applause]" was sitting across a test scene).
   * Unloading the module does stop them. Both names are sent because the player
   * has used each at different times. */
  const killCaptions = useCallback(() => {
    send('unloadModule', ['captions']);
    send('unloadModule', ['cc']);
  }, [send]);

  const beginPlayback = useCallback(() => {
    send('playVideo');
    killCaptions();
    // Captions can re-arm as playback starts, so knock them out once more.
    window.setTimeout(killCaptions, 1200);
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    // The end parameter already bounds the clip; this is the backstop for a
    // replay, where that boundary does not always re-apply.
    stopTimer.current = window.setTimeout(
      () => {
        send('pauseVideo');
        setPlaying(false);
        setWatched(true);
        onPlayedRef.current?.();
      },
      Math.max(1, durationRef.current) * 1000 + 400,
    );
  }, [send, killCaptions]);

  /* Everything the player tells us: the handshake reply, the state changes that
   * say whether it is really playing, and the errors that say it never will.
   *
   *   2    the id is malformed          100  the video is gone
   *   5    the HTML5 player cannot      101  the owner disallows embedding
   *        play it                      150  the same as 101
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== ORIGIN) return;
      let payload: { event?: string; info?: unknown } | null = null;
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : (event.data as never);
      } catch {
        return; // not ours; the player also emits non-JSON frames
      }
      if (!payload) return;

      // Any reply at all means the handshake landed.
      if (!readyRef.current) {
        readyRef.current = true;
        setReady(true);
        if (helloTimer.current) window.clearInterval(helloTimer.current);
        if (giveUpTimer.current) window.clearTimeout(giveUpTimer.current);
        killCaptions();
        if (wantPlayRef.current) {
          wantPlayRef.current = false;
          beginPlayback();
        }
      }

      if (payload.event === 'onError') {
        if (reportedRef.current) return;
        reportedRef.current = true;
        const code = Number(payload.info);
        onUnplayableRef.current?.(
          code === 101 || code === 150
            ? 'embedding disabled by the owner'
            : code === 100
              ? 'video removed or private'
              : `player error ${code}`,
        );
        return;
      }

      // Drive the interface from what the player is actually doing, rather than
      // from what we asked it to do a moment ago.
      const info = payload.info as { playerState?: number } | undefined;
      const state = info?.playerState;
      if (payload.event === 'infoDelivery' && typeof state === 'number') {
        if (state === PLAYING || state === BUFFERING) setPlaying(true);
        if (state === PAUSED || state === UNSTARTED) setPlaying(false);
        if (state === ENDED) {
          setPlaying(false);
          setWatched(true);
          onPlayedRef.current?.();
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [beginPlayback, killCaptions]);

  /* Greet the player until it answers. A single message on a timer loses the
   * race whenever the frame is slower than the timer, and there is no way to
   * know from out here whether it landed — the only evidence is a reply. */
  useEffect(() => {
    readyRef.current = false;
    wantPlayRef.current = false;
    reportedRef.current = false;
    setReady(false);
    setPlaying(false);
    setWatched(false);

    const hello = () =>
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), ORIGIN);

    hello();
    helloTimer.current = window.setInterval(hello, HELLO_EVERY_MS);
    giveUpTimer.current = window.setTimeout(() => {
      if (helloTimer.current) window.clearInterval(helloTimer.current);
      if (!readyRef.current && !reportedRef.current) {
        // The frame is there and the player is not answering. From the
        // learner's side this is indistinguishable from a dead video, and
        // leaving it on screen is how this feature used to waste a round.
        reportedRef.current = true;
        onUnplayableRef.current?.('the player never started');
      }
    }, HELLO_TIMEOUT_MS);

    return () => {
      if (helloTimer.current) window.clearInterval(helloTimer.current);
      if (giveUpTimer.current) window.clearTimeout(giveUpTimer.current);
      if (stopTimer.current) window.clearTimeout(stopTimer.current);
      // Stop the player before the frame is taken away. Removing the iframe
      // should be enough on its own, but asking first costs one message and
      // means the audio is never mid-buffer when the element disappears.
      if (readyRef.current) {
        frameRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'stopVideo', args: [] }),
          ORIGIN,
        );
      }
    };
  }, [src]);

  const play = () => {
    if (!readyRef.current) {
      // Remember the intent; the handshake will run it the moment it lands.
      wantPlayRef.current = true;
      return;
    }
    beginPlayback();
  };

  const replay = () => {
    if (!readyRef.current) {
      wantPlayRef.current = true;
      return;
    }
    send('seekTo', [startRef.current, true]);
    beginPlayback();
  };

  const waitingToStart = wantPlayRef.current && !ready;

  return (
    <div className="relative w-full bg-black" style={{ aspectRatio: '16 / 9', maxHeight: 360 }}>
      <iframe
        ref={frameRef}
        src={src}
        title="Scene"
        allow="encrypted-media; autoplay"
        className="absolute inset-0 h-full w-full border-0"
        // The player often finishes loading after any timer we could set, so
        // the greeting is also offered the moment the frame reports itself in.
        onLoad={() => {
          frameRef.current?.contentWindow?.postMessage(
            JSON.stringify({ event: 'listening' }),
            ORIGIN,
          );
        }}
      />
      {/* Transparent, and deliberately on top of everything the player draws. */}
      <div className="absolute inset-0" onContextMenu={(e) => e.preventDefault()} />

      {!playing && (
        <div className="absolute inset-0 grid place-items-center">
          <button
            onClick={watched ? replay : play}
            disabled={waitingToStart}
            className="rounded-full bg-black/70 px-[22px] py-[12px] font-sans text-[13px] font-semibold text-white backdrop-blur-sm hover:bg-black/85 disabled:opacity-70"
          >
            {waitingToStart ? 'starting the player…' : watched ? '↺ Watch it again' : '▶ Play the scene'}
          </button>
        </div>
      )}

      {playing && (
        <div className="pointer-events-none absolute bottom-[10px] right-[12px] rounded-full bg-black/60 px-[10px] py-[4px] font-mono text-[10px] text-white/80">
          {durationS}s of video
        </div>
      )}
    </div>
  );
}
