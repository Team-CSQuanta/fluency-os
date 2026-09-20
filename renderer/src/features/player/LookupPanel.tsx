import { useEffect, useRef, useState } from 'react';
import { useMediaStore } from '@/store/mediaStore';
import { useVocabularyStore } from '@/store/vocabularyStore';
import type { AiEnrichOut, CueOut, DictionarySearchOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

interface Props {
  mediaId: string;
  term: string;
  cue: CueOut | null;
  onSaved: (message: string) => void;
}

/** The instant lookup panel (spec §4.1.2).
 *
 * Ordered by how fast each part can answer, because the panel opens while the
 * film is paused and the learner is waiting: the line and the timecode are
 * already known, the dictionary is a network call, and the AI is a local model
 * that takes seconds — so it is opt-in per lookup rather than fired
 * automatically on every clicked word.
 */
export function LookupPanel({ mediaId, term, cue, onSaved }: Props) {
  const { searchDictionary, clearSearch, searchResult, searchStatus, searchError, aiEnrich, speakText } =
    useVocabularyStore();
  const saveWord = useMediaStore((s) => s.saveWord);

  const [senseIndex, setSenseIndex] = useState(0);
  const [ai, setAi] = useState<AiEnrichOut | null>(null);
  const [aiSense, setAiSense] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setSenseIndex(0);
    setAi(null);
    setAiSense(null);
    setAiError(null);
    setSaved(false);
    setSaveError(null);
    clearSearch();
    if (term.trim()) void searchDictionary(term.trim());
  }, [term, searchDictionary, clearSearch]);

  const result: DictionarySearchOut | null = searchResult;
  const senses = result?.senses ?? [];
  const sense = senses[senseIndex];
  const dictDefinition = sense?.definition ?? '';
  const staleForSense = Boolean(ai && aiSense !== null && aiSense !== dictDefinition);

  const hear = async (text: string) => {
    try {
      const url = await speakText(text);
      audio.current?.pause();
      audio.current = new Audio(url);
      void audio.current.play();
    } catch {
      // The voice is optional here; the panel keeps working without it.
    }
  };

  const runAi = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const forSense = dictDefinition;
      const out = await aiEnrich(term, {
        dictionaryDefinition: forSense || undefined,
        // The subtitle line is the context — that is the whole advantage of
        // looking a word up here rather than in a dictionary.
        context: cue?.text,
      });
      setAi(out);
      setAiSense(forSense || null);
    } catch (err) {
      setAiError(friendlyMessage(err, 'Asking the AI'));
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!cue) return;
    setSaving(true);
    setSaveError(null);
    try {
      const out = await saveWord({
        mediaId,
        word: term,
        cueId: cue.id,
        cueText: cue.text,
        startMs: cue.start_ms,
        endMs: cue.end_ms,
        pos: sense?.pos ?? '',
        definition: dictDefinition,
        example: sense?.example ?? null,
        synonyms: result?.synonyms?.slice(0, 6) ?? [],
        ipa: result?.ipa ?? null,
        audioUrl: result?.audio_url ?? null,
        aiDefinition: staleForSense ? null : (ai?.definition ?? null),
        aiExamples: staleForSense ? [] : (ai?.examples ?? []),
        aiMnemonic: staleForSense ? null : (ai?.mnemonic ?? null),
        aiUsageNote: staleForSense ? null : (ai?.usage_note ?? null),
        aiSenseDefinition: staleForSense ? null : (ai ? dictDefinition || null : null),
      });
      setSaved(true);
      onSaved(
        out.context_added
          ? `saved “${out.word}” · clip queued`
          : `“${out.word}” already has this moment saved`,
      );
    } catch (err) {
      setSaveError(friendlyMessage(err, 'Saving this word'));
    } finally {
      setSaving(false);
    }
  };

  return (
    // No shell of its own: SidePanel owns the aside, the tab strip and the
    // close button, so the lookup and the saved list share one frame.
    <>
      <div className="flex items-start justify-between gap-2 border-b border-line2 px-4 py-[13px]">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-sans text-[18px] font-semibold text-tx">{term}</span>
            <button
              onClick={() => void hear(term)}
              title="hear it"
              className="flex-none rounded-field border border-line2 px-[7px] py-[2px] font-mono text-[10px] text-tx2 hover:border-acc hover:text-acc"
            >
              ▶ say
            </button>
          </div>
          <div className="mt-[3px] flex flex-wrap items-center gap-[7px] font-mono text-[10px] text-tx3">
            {result?.ipa && <span>{result.ipa}</span>}
            {sense?.pos && <span>{sense.pos}</span>}
            {result?.cefr && <span className="text-acc">{result.cefr}</span>}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-[14px]">
        {cue && (
          <section className="mb-[16px]">
            <Label>in this line</Label>
            <p className="mt-[6px] font-sans text-[12.5px] leading-[1.65] text-tx2">“{cue.text}”</p>
          </section>
        )}

        <section className="mb-[16px]">
          <Label>dictionary</Label>
          {searchStatus === 'loading' && <Muted>looking it up…</Muted>}
          {searchStatus === 'error' && <Muted>{searchError ?? 'the dictionary is unreachable'}</Muted>}
          {searchStatus === 'not-found' && (
            <Muted>no dictionary entry — it can still be saved, and the AI can explain it</Muted>
          )}
          {sense && (
            <>
              <p className="mt-[6px] font-sans text-[12.5px] leading-[1.65] text-tx">{sense.definition}</p>
              {sense.example && (
                <p className="mt-[6px] font-sans text-[11.5px] italic leading-[1.6] text-tx3">“{sense.example}”</p>
              )}
              {senses.length > 1 && (
                <>
                  {/* Numbered, because the part of speech alone does not
                      distinguish them: a word with four adjective senses used
                      to render four chips all reading "adjective". */}
                  <div className="mt-[10px] flex flex-wrap items-center gap-[5px]">
                    {senses.slice(0, 8).map((s, i) => (
                      <button
                        key={i}
                        onClick={() => setSenseIndex(i)}
                        title={s.definition}
                        className="flex items-center gap-[5px] rounded-full border px-[9px] py-[3px] font-sans text-[10.5px] font-medium"
                        style={{
                          borderColor: i === senseIndex ? 'var(--accLine)' : 'var(--line2)',
                          background: i === senseIndex ? 'var(--accSoft)' : 'transparent',
                          color: i === senseIndex ? 'var(--acc)' : 'var(--tx3)',
                        }}
                      >
                        <span className="font-mono text-[9.5px] opacity-70">{i + 1}</span>
                        {shortPos(s.pos)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-[7px] font-mono text-[9.5px] text-tx3">
                    sense {senseIndex + 1} of {senses.length} · hover a number to preview it
                  </p>
                </>
              )}
            </>
          )}
        </section>

        <section className="mb-[16px]">
          <div className="flex items-center justify-between">
            <Label>in context</Label>
            <button
              onClick={() => void runAi()}
              disabled={aiBusy}
              className="rounded-field border border-line2 px-[9px] py-[3px] font-mono text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
            >
              {aiBusy ? 'thinking…' : ai ? 'again' : 'ask the AI'}
            </button>
          </div>
          {aiError && <Muted>{aiError}</Muted>}
          {!ai && !aiBusy && !aiError && (
            <Muted>the local model explains this sense using the line above — takes a few seconds</Muted>
          )}
          {ai && staleForSense && <Muted>that explanation was for another sense — ask again</Muted>}
          {ai && !staleForSense && (
            <div className="mt-[6px] flex flex-col gap-[8px]">
              <p className="font-sans text-[12.5px] leading-[1.65] text-tx">{ai.definition}</p>
              {ai.examples.map((example, i) => (
                <p key={i} className="font-sans text-[11.5px] leading-[1.6] text-tx2">
                  · {example}
                </p>
              ))}
              {ai.mnemonic && (
                <p className="rounded-panel bg-panel2 px-[10px] py-[7px] font-sans text-[11.5px] leading-[1.6] text-tx2">
                  {ai.mnemonic}
                </p>
              )}
              {ai.usage_note && <p className="font-mono text-[10px] text-tx3">{ai.usage_note}</p>}
            </div>
          )}
        </section>

        {(result?.synonyms.length ?? 0) > 0 && (
          <section className="mb-[16px]">
            <Label>near synonyms</Label>
            <div className="mt-[6px] flex flex-wrap gap-[5px]">
              {result!.synonyms.slice(0, 8).map((s) => (
                <span key={s} className="rounded-full bg-line2 px-[8px] py-[3px] font-mono text-[9.5px] text-tx2">
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="border-t border-line2 px-4 py-[13px]">
        {saveError && <p className="mb-[8px] font-sans text-[11px] text-[#e06c6c]">{saveError}</p>}
        <button
          onClick={() => void save()}
          disabled={saving || saved || !cue}
          className="w-full rounded-field bg-accSolid px-[14px] py-[10px] font-sans text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
        >
          {saved ? 'saved ✓' : saving ? 'saving…' : 'Save with this moment'}
        </button>
        <p className="mt-[7px] font-mono text-[9.5px] leading-[1.6] text-tx3">
          stores the word, the line, the timecode, and cuts a clip in the background
        </p>
      </div>
    </>
  );
}

/** Part-of-speech abbreviated to fit a chip. Full form stays in the header,
 * where there is room for it. */
function shortPos(pos: string): string {
  const map: Record<string, string> = {
    noun: 'noun',
    verb: 'verb',
    adjective: 'adj',
    adverb: 'adv',
    pronoun: 'pron',
    preposition: 'prep',
    conjunction: 'conj',
    interjection: 'interj',
    determiner: 'det',
    numeral: 'num',
    'proper noun': 'name',
    name: 'name',
  };
  return map[pos.toLowerCase()] ?? (pos || 'sense');
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-tx2">{children}</div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="mt-[6px] font-sans text-[11.5px] leading-[1.6] text-tx3">{children}</p>;
}
