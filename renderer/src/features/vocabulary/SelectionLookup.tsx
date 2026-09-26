import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/apiClient';
import { useVocabularyStore } from '@/store/vocabularyStore';
import type { DictionarySearchOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

/** Look a word up where you met it, by selecting it.
 *
 * Every other way into the dictionary asks the learner to leave what they are
 * reading: open Vocabulary, open the add dialog, type the word again. The word
 * they did not know is right there on screen, and the sentence around it — the
 * thing that makes it stick — is right there too and gets lost on the way.
 *
 * So: select it, and a small box arrives beside the selection with the meaning
 * in it and one button to keep it. The sentence it came from is saved with it
 * without being asked for.
 *
 * TWO SOURCES, NOT ONE. A dictionary is an index of words, and the things a
 * learner selects are often not words: "helmets race", "chip away", a name, a
 * turn of phrase. Those come back "no entry", which is true and useless. The
 * model has no such index — it reads the sentence — so when the dictionary has
 * nothing it is asked instead, without being asked to be asked, because a dead
 * end is not worth making someone click through to. When the dictionary does
 * answer, the model is one click away and its reading lands beside the
 * dictionary's rather than replacing it: the two are good at different halves
 * of the question, and both are saved with the word.
 *
 * Mounted beside any region of text; `within` says which one, so a selection in
 * the sidebar or a form does not summon a dictionary.
 */

/** Longer than this and a selection is someone copying a passage, not asking
 * what a word means. Popping a box over every drag would make the text
 * tiresome to work with. Short phrases are deliberately inside the limit —
 * they are the ones the dictionary cannot help with. */
const MAX_WORDS = 4;
const MAX_CHARS = 48;

const BOX_WIDTH = 296;
/** Clearance from the selection, and from the window edges when clamping. */
const GAP = 8;
const MARGIN = 8;

interface Props {
  /** The element whose text is lookup-able. Selections outside it are ignored. */
  within: React.RefObject<HTMLElement | null>;
  /** Named in the saved word's note, so months later it is clear where the
   * word was met — "Scene Description Challenge", "Conversation", a book. */
  source?: string;
}

interface Target {
  /** The word as it will be looked up, stripped of the punctuation that comes
   * with a double-click ("ice," → "ice"). */
  term: string;
  /** The sentence it sat in — the note, and what the model reads. */
  context: string;
  /** Live, so the box follows the text when the panel behind it scrolls. */
  range: Range;
}

/** What the model made of it. Flattened from the two endpoints — ai-explain
 * when there is no dictionary entry to build on, ai-enrich when there is —
 * so the box renders one shape whichever answered. */
interface AiReading {
  definition: string;
  examples: string[];
  usageNote: string;
  /** Not shown — the box is meant to stay small — but kept on the saved word,
   * where the detail page does show it. Throwing away a hook the model has
   * already been paid for would be the wasteful choice. */
  mnemonic: string;
  pos: string;
  synonyms: string[];
  /** The dictionary sense it was asked about, or null when it was asked cold.
   * A word with nine senses gets nine different answers, and showing one
   * against another sense would be a quiet lie. */
  forSense: string | null;
}

type Status = 'loading' | 'ready' | 'error';
type AiStatus = 'idle' | 'loading' | 'error';

/** Strip the punctuation a double-click drags in, and the quotes around a
 * quoted line, without touching the hyphen or apostrophe inside a word. */
function cleanTerm(raw: string): string {
  return raw
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
}

/** The block of text a node sits in — the paragraph, list item or cell,
 * rather than whatever inline span happens to wrap the word. */
function blockAncestor(node: Node, within: HTMLElement): HTMLElement {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  while (el && el !== within) {
    if (!getComputedStyle(el).display.startsWith('inline')) return el;
    el = el.parentElement;
  }
  return within;
}

/** The sentence containing the term.
 *
 * Carried for two reasons: it is what the model needs to say which sense is
 * meant, and it is the part that is gone once the screen changes. A definition
 * can always be looked up again; where you met the word cannot. */
function sentenceAround(range: Range, term: string, within: HTMLElement): string {
  const block = blockAncestor(range.startContainer, within);
  const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((s) => s.toLowerCase().includes(term.toLowerCase())) ?? text;
  // The captions are numbered in the markup, so the block's text begins with
  // the ordinal. It is part of the list, not part of the sentence.
  return hit.replace(/^\d+[.)]?\s*/, '').slice(0, 400);
}

export function SelectionLookup({ within, source }: Props) {
  const saveManualWord = useVocabularyStore((s) => s.saveManualWord);
  const aiExplain = useVocabularyStore((s) => s.aiExplain);
  const aiEnrich = useVocabularyStore((s) => s.aiEnrich);

  const [target, setTarget] = useState<Target | null>(null);
  const [at, setAt] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [result, setResult] = useState<DictionarySearchOut | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [senseIndex, setSenseIndex] = useState(0);
  const [ai, setAi] = useState<AiReading | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle');
  const [aiError, setAiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setTarget(null);
    setAt(null);
  }, []);

  /** Place the box under the selection, or above it when there is no room
   * below, clamped so it never hangs off the side of the window. */
  const position = useCallback((range: Range) => {
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    const height = boxRef.current?.offsetHeight ?? 150;
    const above = rect.bottom + GAP + height > window.innerHeight && rect.top - GAP - height > 0;
    const left = Math.min(
      Math.max(MARGIN, rect.left + rect.width / 2 - BOX_WIDTH / 2),
      window.innerWidth - BOX_WIDTH - MARGIN,
    );
    return { left, above, top: above ? rect.top - GAP - height : rect.bottom + GAP };
  }, []);

  // What the learner selected, read after the browser has settled the
  // selection rather than during the mouseup that caused it.
  useEffect(() => {
    const onRelease = (e: MouseEvent | KeyboardEvent) => {
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return;
      // Keyboard selection is shift-modified. Without this the Escape that
      // closes the box arrives here on its way up, finds the selection still
      // standing, and opens it again.
      if (e instanceof KeyboardEvent && !e.shiftKey) return;
      requestAnimationFrame(() => {
        const host = within.current;
        const sel = window.getSelection();
        if (!host || !sel || sel.isCollapsed || sel.rangeCount === 0) return close();

        const range = sel.getRangeAt(0);
        if (!host.contains(range.commonAncestorContainer)) return close();

        const term = cleanTerm(sel.toString());
        if (!term || term.length > MAX_CHARS || term.split(/\s+/).length > MAX_WORDS) return close();

        setTarget({ term, range: range.cloneRange(), context: sentenceAround(range, term, host) });
      });
    };
    document.addEventListener('mouseup', onRelease);
    document.addEventListener('keyup', onRelease);
    return () => {
      document.removeEventListener('mouseup', onRelease);
      document.removeEventListener('keyup', onRelease);
    };
  }, [within, close]);

  // Dismissal: Escape, or a click that starts anywhere but inside the box.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !boxRef.current?.contains(e.target)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [target, close]);

  // The box is anchored to text that scrolls, so it is re-placed against the
  // live range rather than pinned where it first appeared.
  useEffect(() => {
    if (!target) return;
    let frame = 0;
    const replace = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = position(target.range);
        // Only when something moved. The first pass places the box before it
        // has been rendered, so it measures an estimated height; this effect
        // runs again once it is on screen and corrects that — and stops,
        // rather than looping, because by then the numbers agree.
        setAt((prev) =>
          prev && next && prev.top === next.top && prev.left === next.left && prev.above === next.above
            ? prev
            : next,
        );
      });
    };
    replace();
    window.addEventListener('scroll', replace, true);
    window.addEventListener('resize', replace);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', replace, true);
      window.removeEventListener('resize', replace);
    };
  }, [target, position, result, status, ai, aiStatus, at]);

  // The dictionary. The backend answers from the bundled lexicon or this
  // machine's cache before it will touch the network, so a word looked up
  // before comes back instantly.
  useEffect(() => {
    if (!target) return;
    let live = true;
    setStatus('loading');
    setResult(null);
    setSenseIndex(0);
    setAi(null);
    setAiStatus('idle');
    setAiError(null);
    setSaved(null);
    setSaveError(null);
    api
      .get<DictionarySearchOut>(`/vocabulary/dictionary-search?w=${encodeURIComponent(target.term)}`)
      .then((r) => live && (setResult(r), setStatus('ready')))
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
  }, [target]);

  const senses = result?.senses ?? [];
  const sense = senses[senseIndex];
  const found = Boolean(result?.found && sense);
  const dictDefinition = sense?.definition ?? null;

  /** Ask the model. Cold when the dictionary had nothing — it reads the
   * sentence and says what the term means there. Alongside the dictionary
   * otherwise — it is given the sense and adds what a dictionary leaves out. */
  const askAi = useCallback(
    async (against: string | null) => {
      if (!target) return;
      setAiStatus('loading');
      setAiError(null);
      try {
        if (against === null && target.context) {
          const out = await aiExplain(target.term, target.context);
          setAi({
            definition: out.definition,
            examples: out.example ? [out.example] : [],
            usageNote: '',
            mnemonic: '',
            pos: out.pos,
            synonyms: out.synonyms,
            forSense: null,
          });
        } else {
          const out = await aiEnrich(target.term, {
            dictionaryDefinition: against ?? undefined,
            context: target.context || undefined,
          });
          setAi({
            definition: out.definition,
            examples: out.examples,
            usageNote: out.usage_note,
            mnemonic: out.mnemonic,
            pos: '',
            synonyms: out.synonyms,
            forSense: against,
          });
        }
        setAiStatus('idle');
      } catch (err) {
        setAiError(friendlyMessage(err, 'Asking the AI'));
        setAiStatus('error');
      }
    },
    [target, aiExplain, aiEnrich],
  );

  // No entry anywhere: ask the model without being asked to. This is the case
  // the two-source design exists for, and stopping at "no dictionary has this"
  // to wait for a click would be stopping one step short of the answer.
  //
  // A dictionary that could not be REACHED counts as one with no entry. The
  // model runs locally or on a different service, so it is often still there
  // when the dictionary is not, and the learner wanted a meaning either way.
  useEffect(() => {
    if ((status !== 'ready' && status !== 'error') || !target || found) return;
    if (ai || aiStatus !== 'idle') return;
    void askAi(null);
  }, [status, target, found, ai, aiStatus, askAi]);

  if (!target || !at) return null;

  // The model was asked about a different sense than the one on screen.
  const staleForSense = Boolean(ai && ai.forSense !== null && ai.forSense !== dictDefinition);
  const showAi = ai && !staleForSense;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const keep = showAi ? ai : null;
      const { alreadySaved } = await saveManualWord({
        word: result?.word || target.term,
        pos: sense?.pos || keep?.pos || 'unknown',
        // Whichever source actually has one, dictionary first. A term with no
        // entry anywhere and no model to ask is still worth keeping, and is
        // marked as lacking a definition rather than given a fake one.
        definition: dictDefinition || keep?.definition || `(no definition yet — ${target.term})`,
        example: sense?.example ?? keep?.examples[0] ?? undefined,
        synonyms: Array.from(new Set([...(result?.synonyms ?? []), ...(keep?.synonyms ?? [])])).slice(0, 6),
        ipa: result?.ipa ?? undefined,
        audioUrl: result?.audio_url ?? undefined,
        note: [source && `met in ${source}`, target.context && `“${target.context}”`]
          .filter(Boolean)
          .join('\n\n') || undefined,
        // Kept apart from the dictionary's own fields rather than merged into
        // them, so the card can always say which source said what.
        aiDefinition: keep?.definition || undefined,
        aiExamples: keep?.examples,
        aiUsageNote: keep?.usageNote || undefined,
        aiMnemonic: keep?.mnemonic || undefined,
        aiSenseDefinition: keep && dictDefinition ? dictDefinition : undefined,
      });
      setSaved(alreadySaved ? 'already in your vocabulary' : 'saved to vocabulary');
    } catch (err) {
      setSaveError(friendlyMessage(err, 'Saving this word'));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label={`Dictionary: ${target.term}`}
      style={{ top: at.top, left: at.left, width: BOX_WIDTH }}
      className="fixed z-[95] rounded-panel border border-line bg-panel shadow-panel"
    >
      <div className="flex items-baseline gap-[7px] border-b border-line2 px-[11px] py-[8px]">
        <span className="min-w-0 truncate font-sans text-[13px] font-semibold text-tx">{target.term}</span>
        {result?.ipa && <span className="flex-none font-mono text-[9.5px] text-tx3">{result.ipa}</span>}
        {result?.cefr && (
          <span className="ml-auto flex-none rounded-[4px] border border-accLine px-[5px] font-mono text-[9px] font-medium text-acc">
            {result.cefr}
          </span>
        )}
      </div>

      <div className="max-h-[300px] overflow-y-auto px-[11px] py-[9px]">
        {status === 'loading' && <p className="font-mono text-[10px] text-tx3">looking it up…</p>}

        {status === 'error' && (
          <p className="font-sans text-[11px] leading-[1.55] text-tx3">
            The dictionary could not be reached. It can still be saved, and the meaning filled in later.
          </p>
        )}

        {found && (
          <>
            <Label>dictionary</Label>
            {sense.pos && <div className="mt-[3px] font-mono text-[9px] text-tx3">{sense.pos}</div>}
            <p className="mt-[3px] font-sans text-[11.5px] leading-[1.6] text-tx">{sense.definition}</p>
            {sense.example && (
              <p className="mt-[5px] font-sans text-[10.5px] italic leading-[1.5] text-tx3">“{sense.example}”</p>
            )}
            {/* Which sense is on screen is which sense gets saved, and which
                one the model is asked about, so a word with several needs a
                way to reach the right one. */}
            {senses.length > 1 && (
              <div className="mt-[7px] flex items-center gap-[6px] font-mono text-[9.5px] text-tx3">
                <button
                  onClick={() => setSenseIndex((i) => Math.max(0, i - 1))}
                  disabled={senseIndex === 0}
                  className="px-[3px] hover:text-acc disabled:opacity-30"
                >
                  ‹
                </button>
                <span>
                  sense {senseIndex + 1} of {senses.length}
                </span>
                <button
                  onClick={() => setSenseIndex((i) => Math.min(senses.length - 1, i + 1))}
                  disabled={senseIndex === senses.length - 1}
                  className="px-[3px] hover:text-acc disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            )}
          </>
        )}

        {status === 'ready' && !found && (
          <p className="font-sans text-[10.5px] leading-[1.5] text-tx3">
            No dictionary has “{target.term}” — so the AI was asked to read it in the sentence instead.
          </p>
        )}

        {(status !== 'loading' || aiStatus !== 'idle' || ai) && (
          <div className={found ? 'mt-[10px] border-t border-line2 pt-[8px]' : 'mt-[8px]'}>
            <div className="flex items-center justify-between gap-2">
              <Label>{found ? 'in this sentence' : 'what the AI makes of it'}</Label>
              {/* Offered, not spent. The dictionary already answered; a model
                  call costs seconds and, on a cloud key, quota. */}
              {found && aiStatus !== 'loading' && (
                <button
                  onClick={() => void askAi(dictDefinition)}
                  className="flex-none rounded-field border border-line2 px-[7px] py-[1px] font-mono text-[9px] text-tx2 hover:border-acc hover:text-acc"
                >
                  {ai ? 'again' : 'ask the AI'}
                </button>
              )}
            </div>

            {aiStatus === 'loading' && <Muted>asking the AI…</Muted>}
            {aiStatus === 'error' && <Muted>{aiError}</Muted>}
            {aiStatus === 'idle' && !ai && found && (
              <Muted>the model reads the line above and says which sense is meant</Muted>
            )}
            {staleForSense && aiStatus !== 'loading' && <Muted>that was about another sense — ask again</Muted>}

            {showAi && (
              <>
                {ai.pos && <div className="mt-[3px] font-mono text-[9px] text-tx3">{ai.pos}</div>}
                <p className="mt-[3px] font-sans text-[11.5px] leading-[1.6] text-tx">{ai.definition}</p>
                {ai.examples.slice(0, 2).map((example, i) => (
                  <p key={i} className="mt-[4px] font-sans text-[10.5px] italic leading-[1.5] text-tx3">
                    “{example}”
                  </p>
                ))}
                {ai.usageNote && <p className="mt-[5px] font-mono text-[9px] leading-[1.5] text-tx3">{ai.usageNote}</p>}
              </>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-line2 px-[11px] py-[8px]">
        {saveError && <p className="mb-[6px] font-sans text-[10.5px] text-[#e06c6c]">{saveError}</p>}
        {saved ? (
          <p className="font-mono text-[10px] text-acc">{saved} ✓</p>
        ) : (
          <button
            onClick={() => void save()}
            disabled={saving || status === 'loading' || aiStatus === 'loading'}
            className="w-full rounded-field border border-accLine bg-accSoft py-[6px] font-sans text-[11px] font-medium text-acc hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'saving…' : '＋ Add to vocabulary'}
          </button>
        )}
        {!saved && (
          <p className="mt-[6px] font-mono text-[9px] leading-[1.5] text-tx3">
            {showAi && found
              ? 'saved with both readings and the sentence'
              : 'saved with the sentence it came from'}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">{children}</div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="mt-[4px] font-sans text-[10.5px] leading-[1.5] text-tx3">{children}</p>;
}
