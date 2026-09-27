import { describe, expect, it } from 'vitest';
import { inQuietHours } from '@/lib/quietHours';

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 8, 27, h, m);
};

describe('quiet hours — when the review reminder stays silent', () => {
  it('covers a window that crosses midnight', () => {
    expect(inQuietHours(at('23:30'), '22:00', '08:00')).toBe(true);
    expect(inQuietHours(at('03:00'), '22:00', '08:00')).toBe(true);
    expect(inQuietHours(at('12:00'), '22:00', '08:00')).toBe(false);
  });

  it('starts on the start minute and is over on the end minute', () => {
    expect(inQuietHours(at('22:00'), '22:00', '08:00')).toBe(true);
    expect(inQuietHours(at('08:00'), '22:00', '08:00')).toBe(false);
  });

  it('handles a window within one day', () => {
    expect(inQuietHours(at('13:30'), '13:00', '14:00')).toBe(true);
    expect(inQuietHours(at('14:30'), '13:00', '14:00')).toBe(false);
  });

  it('treats the same start and end as no quiet hours', () => {
    expect(inQuietHours(at('03:00'), '00:00', '00:00')).toBe(false);
  });
});
