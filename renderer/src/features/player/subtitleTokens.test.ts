import { describe, expect, it } from 'vitest';
import { inSelection, selectionText, tokenize } from '@/features/player/subtitleTokens';
import { timecode } from '@/features/player/playerFormat';

describe('subtitleTokens — clicking words in a subtitle', () => {
  it('looks up a sentence-final word without its full stop', () => {
    const tokens = tokenize('They were reticent about the findings.');
    const last = tokens[tokens.length - 1];
    expect(last.raw).toBe('findings.');
    expect(last.clean).toBe('findings');
  });

  it("keeps apostrophes and hyphens inside words (\"don't\", \"well-read\")", () => {
    const clean = tokenize("I don't know, she's well-read!").filter((t) => t.selectable).map((t) => t.clean);
    expect(clean).toEqual(['I', "don't", 'know', "she's", 'well-read']);
  });

  it('does not make spaces or stray punctuation clickable', () => {
    const tokens = tokenize('Wait — what?');
    expect(tokens.filter((t) => t.selectable).map((t) => t.clean)).toEqual(['Wait', 'what']);
  });

  it('turns a dragged phrase into a clean lookup, in either drag direction', () => {
    const tokens = tokenize('They were reticent about the findings.');
    const from = tokens.findIndex((t) => t.clean === 'reticent');
    const to = tokens.length - 1;
    expect(selectionText(tokens, from, to)).toBe('reticent about the findings');
    expect(selectionText(tokens, to, from)).toBe('reticent about the findings');
  });

  it('knows which tokens are inside the selection', () => {
    expect(inSelection(3, 1, 4)).toBe(true);
    expect(inSelection(3, 4, 1)).toBe(true);
    expect(inSelection(5, 1, 4)).toBe(false);
    expect(inSelection(3, null, 4)).toBe(false);
  });
});

describe('playerFormat — timecodes', () => {
  it('formats minutes and seconds', () => {
    expect(timecode(65_000)).toBe('1:05');
  });

  it('adds hours only when needed', () => {
    expect(timecode(3_725_000)).toBe('1:02:05');
  });

  it('can show milliseconds, and never goes negative', () => {
    expect(timecode(1_234, { withMillis: true })).toBe('0:01.234');
    expect(timecode(-500)).toBe('0:00');
  });
});
