import type { CSSProperties, ReactNode } from 'react';
import type { CorrectionKind, TurnCorrection } from '@/types/api';

export const KIND_LABEL: Record<CorrectionKind, string> = {
  grammar: 'grammar',
  word: 'better word',
  sentence: 'rephrased',
};

/** Time between one fix and the next, so each is seen being made. */
const STAGGER_MS = 800;

interface Props {
  text: string;
  corrections: TurnCorrection[];
  /** Play the strike-and-replace once, for a turn that has just arrived.
   * Turns already in the conversation when it was opened show the result. */
  animate: boolean;
}

/** A learner's message with the partner's fixes written onto it: the words
 * they got wrong struck through, the better ones beside them.
 *
 * The fix used to be a note at the end of the partner's reply, which the
 * voice then read out as if the partner had said it. On the message itself
 * it is seen where the mistake was, and the conversation keeps its flow.
 *
 * A fix whose words cannot be found in the message — the model paraphrased
 * them — goes on its own line underneath instead. */
export function CorrectedText({ text, corrections, animate }: Props) {
  const { inline, below } = place(text, corrections);
  const parts: ReactNode[] = [];
  let from = 0;
  for (const { at, fix, order } of inline) {
    parts.push(text.slice(from, at));
    parts.push(<Fix key={order} fix={fix} said={text.slice(at, at + fix.wrong.length)} order={order} />);
    from = at + fix.wrong.length;
  }
  parts.push(text.slice(from));

  return (
    <span className={animate ? 'fos-fix-animate' : undefined}>
      {parts}
      {below.map(({ fix, order }) => (
        <span key={order} className="mt-[6px] block text-[12.5px]">
          <Fix fix={fix} said={fix.wrong} order={order} />
        </span>
      ))}
    </span>
  );
}

function Fix({ fix, said, order }: { fix: TurnCorrection; said: string; order: number }) {
  const title = `${KIND_LABEL[fix.kind]}: "${fix.wrong}" → "${fix.right}"${fix.why ? ` — ${fix.why}` : ''}`;
  return (
    <span title={title} data-kind={fix.kind} style={{ '--fix-delay': `${order * STAGGER_MS}ms` } as CSSProperties}>
      <del className="fos-fix-wrong">{said}</del> <ins className="fos-fix-right">{fix.right}</ins>
    </span>
  );
}

interface Placed {
  at: number;
  fix: TurnCorrection;
  /** Its place in the list the partner gave — most important first — which
   * is also the order the fixes are animated in. */
  order: number;
}

/** Where each fix goes in the text. The server has already dropped fixes
 * that overlap, so a clash here only means the same words occur twice; the
 * later occurrence is used. */
function place(text: string, corrections: TurnCorrection[]) {
  const inline: Placed[] = [];
  const below: Omit<Placed, 'at'>[] = [];
  const lower = text.toLowerCase();
  corrections.forEach((fix, order) => {
    const needle = fix.wrong.toLowerCase();
    let at = lower.indexOf(needle);
    while (at >= 0 && inline.some((p) => at < p.at + p.fix.wrong.length && p.at < at + needle.length)) {
      at = lower.indexOf(needle, at + 1);
    }
    if (at >= 0 && needle) inline.push({ at, fix, order });
    else below.push({ fix, order });
  });
  inline.sort((a, b) => a.at - b.at);
  return { inline, below };
}
