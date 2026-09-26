import { useEffect, useRef, useState } from 'react';
import { inSelection, selectionText, tokenize } from '@/features/player/subtitleTokens';
import type { CueOut } from '@/types/api';

interface Props {
  cue: CueOut | null;
  nativeCue: CueOut | null;
  dualSubs: boolean;
  blur: boolean;
  size: number;
  opacity: number;
  offset: number;
  /** Space to keep clear on the right, so a centred line does not run under
   * the lookup panel when that panel is overlaying the picture. */
  insetRight?: number;
  selectedWord: string | null;
  onSelect: (text: string, cue: CueOut) => void;
}

/** The subtitle overlay: dual lines, blur-until-hover, and click or drag to
 * look a word or phrase up (spec §4.1.2).
 *
 * Selection is tracked on token indices rather than on the DOM's own text
 * selection: the browser's would let a learner select half a word, and would
 * also fight the video's own click-to-pause handling.
 */
export function SubtitleLayer({
  cue,
  nativeCue,
  dualSubs,
  blur,
  size,
  opacity,
  offset,
  insetRight = 0,
  selectedWord,
  onSelect,
}: Props) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const [head, setHead] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const dragging = useRef(false);

  const tokens = cue ? tokenize(cue.text) : [];

  // A new line clears any half-finished drag — otherwise the indices point
  // into the previous cue's tokens and the highlight lands on the wrong words.
  useEffect(() => {
    setAnchor(null);
    setHead(null);
    dragging.current = false;
  }, [cue?.id]);

  // Only while a drag is actually in progress. With no dependency array this
  // re-subscribed a window listener on every render — four times a second,
  // for the whole time a file is open, to catch a gesture that is not
  // happening.
  useEffect(() => {
    if (anchor === null) return;
    const stop = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (cue && head !== null) {
        const text = selectionText(tokens, anchor, head);
        if (text) onSelect(text, cue);
      }
    };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  });

  if (!cue && !nativeCue) return null;

  const hidden = blur && !hovered;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-[7px] px-[60px] transition-[bottom,padding-right] duration-200"
      style={{ bottom: offset, paddingRight: 60 + insetRight }}
    >
      {cue && (
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="pointer-events-auto flex flex-wrap justify-center gap-y-0 text-center font-sans text-white transition-[filter] duration-150"
          style={{
            fontSize: size,
            lineHeight: 1.4,
            filter: hidden ? 'blur(8px)' : 'none',
            textShadow: '0 2px 10px rgba(0,0,0,.85)',
            background: opacity > 0 ? `rgba(0,0,0,${opacity})` : 'transparent',
            borderRadius: 6,
            padding: opacity > 0 ? '2px 10px' : 0,
          }}
        >
          {tokens.map((token, i) => {
            if (!token.selectable) return <span key={i}>{token.raw}</span>;
            const active =
              inSelection(i, anchor, head) ||
              (anchor === null && selectedWord !== null && token.clean.toLowerCase() === selectedWord.toLowerCase());
            return (
              <span
                key={i}
                onMouseDown={(e) => {
                  e.preventDefault();
                  dragging.current = true;
                  setAnchor(i);
                  setHead(i);
                }}
                onMouseEnter={() => {
                  if (dragging.current) setHead(i);
                }}
                className="cursor-pointer rounded-[3px] px-[2px]"
                style={{
                  background: active ? 'rgba(var(--accRGB),.85)' : 'transparent',
                  borderBottom: active ? 'none' : '1px dotted rgba(255,255,255,.28)',
                }}
              >
                {token.raw}
              </span>
            );
          })}
        </div>
      )}

      {dualSubs && nativeCue && (
        <div
          className="text-center font-sans text-white/60"
          style={{
            fontSize: Math.round(size * 0.68),
            textShadow: '0 2px 10px rgba(0,0,0,.85)',
            filter: hidden ? 'blur(8px)' : 'none',
          }}
        >
          {nativeCue.text}
        </div>
      )}
    </div>
  );
}
