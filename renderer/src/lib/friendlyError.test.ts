import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/apiClient';
import { friendlyError } from '@/lib/friendlyError';

const apiError = (status: number, detail: string) =>
  new ApiError('POST', '/somewhere', status, JSON.stringify({ detail }));

describe('friendlyError — error messages a learner can act on', () => {
  it('offers to start the AI when a request failed because it is not running', () => {
    const e = friendlyError(apiError(503, 'The AI model is not launched yet.'), 'Asking the AI');
    expect(e.needsAi).toBe(true);
    expect(e.title).toBe('Asking the AI needs the AI');
  });

  it('does not blame the AI when the online dictionary is unreachable', () => {
    const e = friendlyError(apiError(503, 'The online dictionary could not be reached.'), 'Looking it up');
    expect(e.needsAi).toBe(false);
    expect(e.body).toBe('The online dictionary could not be reached.');
  });

  it('passes through a message the server wrote for a person', () => {
    const e = friendlyError(apiError(400, 'That word is already in your vocabulary.'), 'Saving');
    expect(e.body).toBe('That word is already in your vocabulary.');
  });

  it('never shows a raw validation error or field name', () => {
    const e = friendlyError(apiError(422, 'end_char must be greater than start_char'), 'Saving');
    expect(e.body).not.toContain('end_char');
    expect(e.technical).toContain('end_char');
  });

  it('explains a server crash without technical detail in the body', () => {
    const e = friendlyError(apiError(500, 'Traceback (most recent call last): ...'), 'Saving');
    expect(e.body).not.toContain('Traceback');
    expect(e.title).toBe("Saving didn't work");
  });

  it('recognises that the background service could not be reached at all', () => {
    const e = friendlyError(new TypeError('Failed to fetch'), 'Loading');
    expect(e.body).toContain('restart');
  });
});
