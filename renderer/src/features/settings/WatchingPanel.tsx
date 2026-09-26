import { useEffect } from 'react';
import { MediaSettingsPanel } from '@/features/settings/MediaSettingsPanel';
import { Row, Section, Slider, Toggle } from '@/features/settings/controls';
import { useMediaStore } from '@/store/mediaStore';

/** Defaults for the player, and the clip engine behind saved words.
 *
 * These are the same switches the transport bar carries, kept here because
 * the bar sets them for the film in front of you and this sets what every
 * film starts as. They are one value, not two — changing either changes both.
 */
export function WatchingPanel() {
  const playerPrefs = useMediaStore((s) => s.playerPrefs);
  const fetchPlayerPrefs = useMediaStore((s) => s.fetchPlayerPrefs);
  const setPlayerPrefs = useMediaStore((s) => s.setPlayerPrefs);

  useEffect(() => {
    void fetchPlayerPrefs();
  }, [fetchPlayerPrefs]);

  return (
    <>
      {playerPrefs && (
        <>
          <Section
            title="Subtitles"
            note="How subtitles start out on every film. The bar at the bottom of the player changes the same settings mid-watch."
          >
            <Row
              label="Show subtitles"
              sub="Off is the harder and more useful exercise — listen first, then turn them on to check."
              control={
                <Toggle
                  label="Show subtitles"
                  checked={playerPrefs.subs_on}
                  onChange={(v) => void setPlayerPrefs({ subs_on: v })}
                />
              }
            />
            <Row
              label="Second language line"
              sub="Your native language under the target one, when the file has a second track."
              control={
                <Toggle
                  label="Second language line"
                  checked={playerPrefs.dual_subs}
                  disabled={!playerPrefs.subs_on}
                  onChange={(v) => void setPlayerPrefs({ dual_subs: v })}
                />
              }
            />
            <Row
              label="Blur until you look"
              sub="Keeps the line hidden until you hover it — so you hear it first and read it only if you need to."
              control={
                <Toggle
                  label="Blur until you look"
                  checked={playerPrefs.blur_subs}
                  disabled={!playerPrefs.subs_on}
                  onChange={(v) => void setPlayerPrefs({ blur_subs: v })}
                />
              }
            />
            <Row
              label="Size"
              stacked
              control={
                <Slider
                  label="Subtitle size"
                  value={playerPrefs.sub_size}
                  min={14}
                  max={44}
                  step={1}
                  onCommit={(v) => void setPlayerPrefs({ sub_size: v })}
                  format={(v) => `${Math.round(v)} px`}
                />
              }
            />
            <Row
              label="Backdrop"
              sub="the dark band behind the text"
              stacked
              control={
                <Slider
                  label="Subtitle backdrop opacity"
                  value={playerPrefs.sub_opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  onCommit={(v) => void setPlayerPrefs({ sub_opacity: v })}
                  format={(v) => (v === 0 ? 'none' : `${Math.round(v * 100)}%`)}
                />
              }
            />
            <Row
              label="Distance from the bottom"
              stacked
              control={
                <Slider
                  label="Subtitle offset"
                  value={playerPrefs.sub_offset}
                  min={0}
                  max={200}
                  step={2}
                  onCommit={(v) => void setPlayerPrefs({ sub_offset: v })}
                  format={(v) => `${Math.round(v)} px`}
                />
              }
            />
          </Section>

          <Section
            title="Playback aids"
            note="Both work off the subtitle line under the playhead, so both need a subtitle track."
          >
            <Row
              label="Pause at the end of each line"
              sub="Stops on every subtitle so you can repeat it before the next one arrives."
              control={
                <Toggle
                  label="Pause at the end of each line"
                  checked={playerPrefs.auto_pause}
                  onChange={(v) => void setPlayerPrefs({ auto_pause: v })}
                />
              }
            />
            <Row
              label="Loop the current line"
              sub="Replays one line until you move on. Seeking anywhere releases it."
              control={
                <Toggle
                  label="Loop the current line"
                  checked={playerPrefs.loop_cue}
                  onChange={(v) => void setPlayerPrefs({ loop_cue: v })}
                />
              }
            />
          </Section>

          <Section
            title="Saved moments"
            note="Saving a word from a film cuts the moment it was said. These set what gets cut."
          >
            <Row
              label="Lead-in"
              sub="how much before the line the clip starts"
              stacked
              control={
                <Slider
                  label="Clip lead-in"
                  value={playerPrefs.clip_pad_before_ms}
                  min={0}
                  max={5000}
                  step={250}
                  onCommit={(v) => void setPlayerPrefs({ clip_pad_before_ms: v })}
                  format={(v) => `${(v / 1000).toFixed(2)} s`}
                />
              }
            />
            <Row
              label="Lead-out"
              sub="and how much after it ends"
              stacked
              control={
                <Slider
                  label="Clip lead-out"
                  value={playerPrefs.clip_pad_after_ms}
                  min={0}
                  max={5000}
                  step={250}
                  onCommit={(v) => void setPlayerPrefs({ clip_pad_after_ms: v })}
                  format={(v) => `${(v / 1000).toFixed(2)} s`}
                />
              }
            />
            <Row
              label="Longest clip"
              sub="a hard ceiling, in case a subtitle line runs long"
              stacked
              control={
                <Slider
                  label="Longest clip"
                  value={playerPrefs.clip_max_ms}
                  min={4000}
                  max={30000}
                  step={1000}
                  onCommit={(v) => void setPlayerPrefs({ clip_max_ms: v })}
                  format={(v) => `${Math.round(v / 1000)} s`}
                />
              }
            />
          </Section>
        </>
      )}

      {/* The clip engine, ffmpeg and what all of it is costing on disk. */}
      <MediaSettingsPanel />
    </>
  );
}
