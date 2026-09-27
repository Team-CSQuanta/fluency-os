/**
 * Beginner tests, part 3: testing frontend code (TypeScript, with Vitest).
 *
 * Same idea as the Python tests: call a function, then `expect` the result.
 * If the result is different, Vitest shows the test in red.
 *
 * Run just the beginner tests with:   npm run test:beginner
 */
import { describe, expect, it } from 'vitest';
import { timecode } from '@/features/player/playerFormat';
import { tokenize } from '@/features/player/subtitleTokens';
import { inQuietHours } from '@/lib/quietHours';

describe('Video player: the time shown under a video', () => {
  it('shows 65 seconds as 1:05', () => {
    // Arrange
    const milliseconds = 65_000;

    // Act
    const shown = timecode(milliseconds);

    // Assert
    expect(shown).toBe('1:05');
  });
});

describe('Subtitles: clicking a word to look it up', () => {
  it('looks up "findings", not "findings." with the full stop', () => {
    // Arrange: a subtitle line ending in a full stop
    const subtitle = 'They studied the findings.';

    // Act: split it into clickable words
    const words = tokenize(subtitle);
    const lastWord = words[words.length - 1];

    // Assert: what the learner sees keeps the full stop, what we look up does not
    expect(lastWord.raw).toBe('findings.');
    expect(lastWord.clean).toBe('findings');
  });
});

describe('Review reminder: quiet hours from 22:00 to 08:00', () => {
  it('stays quiet at 23:30 at night', () => {
    const lateAtNight = new Date(2026, 0, 1, 23, 30);
    expect(inQuietHours(lateAtNight, '22:00', '08:00')).toBe(true);
  });

  it('can remind at 12:00 midday', () => {
    const midday = new Date(2026, 0, 1, 12, 0);
    expect(inQuietHours(midday, '22:00', '08:00')).toBe(false);
  });
});
