import { describe, expect, it } from 'vitest';
import { spokenCount, timeWords, wordWeight } from '@/features/conversation/spokenTiming';

describe('spokenTiming — highlighting the word the voice is on', () => {
  it('gives longer words more time', () => {
    expect(wordWeight('extraordinary')).toBeGreaterThan(wordWeight('cat'));
  });

  it('gives a word before a full stop extra time for the pause after it', () => {
    expect(wordWeight('home.')).toBeGreaterThan(wordWeight('home,'));
    expect(wordWeight('home,')).toBeGreaterThan(wordWeight('home'));
  });

  it('re-joins to exactly the original text', () => {
    const text = 'Well,  that sounds lovely. Where did you go?';
    expect(timeWords(text).map((w) => w.text).join('')).toBe(text);
  });

  it('covers the whole clip from 0 to 1 without gaps', () => {
    const words = timeWords('I went to the market on Sunday morning.');
    expect(words[0].start).toBe(0);
    expect(words[words.length - 1].end).toBeCloseTo(1);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeCloseTo(words[i - 1].end);
  });

  it('counts a word as spoken as soon as the voice starts it', () => {
    const words = timeWords('one two three');
    expect(spokenCount(words, 0)).toBe(0);
    expect(spokenCount(words, words[1].start)).toBe(2);
    expect(spokenCount(words, 1)).toBe(3);
  });

  it('handles empty text', () => {
    expect(timeWords('   ')).toEqual([]);
  });
});
