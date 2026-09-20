import { ApiError } from '@/lib/apiClient';

/** Turns whatever was thrown into something worth showing a person.
 *
 * The app used to put `err.message` on screen. For a failed request that
 * string is "API POST /vocabulary/manual failed: 503 {"detail":"..."}" — the
 * method, the path, the status code and the raw body, which is a log line
 * that happens to be legible, not a message. It tells the reader what our
 * code was doing and nothing about what they should do.
 *
 * Every failure here becomes three things:
 *
 *   title      what did not happen, in the reader's terms
 *   body       why, and what they can do about it
 *   technical  the original text, kept behind a disclosure — it is genuinely
 *              useful when something is properly broken, and hiding it
 *              entirely would just mean nobody could ever report a bug
 */
export interface FriendlyError {
  title: string;
  body: string;
  technical: string | null;
  /** The AI is not running. The caller can offer to start it rather than
   * printing a message about it. */
  needsAi: boolean;
}

/** A backend `detail` written for a person already. These read as sentences,
 * start with a capital, and do not carry a path, a status code or a type
 * name — so they are passed through rather than replaced by something vaguer. */
function looksHumanWritten(detail: string): boolean {
  if (!detail || detail.length > 300) return false;
  if (/^[a-z_]+\.[a-zA-Z]/.test(detail)) return false; // module.Thing
  if (/\b(Traceback|Exception|Error:|None|null|\{|\[)/.test(detail)) return false;
  if (/^(Internal Server Error|Not Found|Unprocessable|Bad Request|Forbidden)/i.test(detail)) return false;
  return /[A-Z]/.test(detail[0]) || detail.includes(' ');
}

/** The network stack failed before any reply came back — the backend is not
 * listening, or the request never left. */
function isOffline(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|Load failed/i.test(err.message);
}

/**
 * @param doing What the reader was trying to do, as a verb phrase starting
 *   with a capital: "Saving this word", "Starting a conversation". It becomes
 *   the title, so it is worth writing one.
 */
export function friendlyError(err: unknown, doing = 'That'): FriendlyError {
  const technical = err instanceof Error ? err.message : err == null ? null : String(err);

  if (isOffline(err)) {
    return {
      title: `${doing} didn't work`,
      body: 'FluencyOS could not reach its own background service. This usually clears up if you restart the app.',
      technical,
      needsAi: false,
    };
  }

  if (err instanceof ApiError) {
    const detail = (err.detail ?? '').trim();

    // The AI is not loaded. Its own dialog handles this properly, with a
    // button that starts it — this is only the fallback wording.
    if (err.status === 503) {
      return {
        title: `${doing} needs the AI`,
        body: looksHumanWritten(detail)
          ? detail
          : 'The AI is not running yet. Start it from the button in the top bar, then try again.',
        technical,
        needsAi: true,
      };
    }

    if (err.status === 401 || err.status === 403) {
      return {
        title: `${doing} didn't work`,
        body: 'FluencyOS lost its connection to its own background service. Restarting the app will reconnect it.',
        technical,
        needsAi: false,
      };
    }

    if (err.status === 404) {
      return {
        title: `${doing} didn't work`,
        body: looksHumanWritten(detail)
          ? detail
          : 'The thing this was about is no longer there — it may have been deleted, or renamed outside FluencyOS.',
        technical,
        needsAi: false,
      };
    }

    // 422 is a validation failure, and FastAPI answers it with a list of field
    // objects rather than a sentence. There is nothing in that list a reader
    // can act on, so it stays in the details.
    if (err.status === 422) {
      return {
        title: `${doing} didn't work`,
        body: looksHumanWritten(detail)
          ? detail
          : "Something in that wasn't in a form FluencyOS could accept. Check anything you typed and try again.",
        technical,
        needsAi: false,
      };
    }

    if (err.status === 409) {
      return {
        title: `${doing} isn't possible yet`,
        body: looksHumanWritten(detail) ? detail : 'Something else has to happen first.',
        technical,
        needsAi: false,
      };
    }

    if (err.status >= 500) {
      return {
        title: `${doing} didn't work`,
        body: 'Something went wrong inside FluencyOS. Nothing you did caused it, and nothing was lost — trying again often works.',
        technical,
        needsAi: false,
      };
    }

    return {
      title: `${doing} didn't work`,
      body: looksHumanWritten(detail) ? detail : 'FluencyOS could not complete that. Trying again often works.',
      technical,
      needsAi: false,
    };
  }

  // Not an API failure at all — a microphone that was refused, a file that
  // could not be read, a bug. The raw text is rarely readable, so it goes
  // into the details and the body says the useful part.
  return {
    title: `${doing} didn't work`,
    body: 'Something went wrong. Trying again often works — and if it keeps happening, the details below are worth reporting.',
    technical,
    needsAi: false,
  };
}

/** The one-line version, for the places that show a message inline rather
 * than opening a dialog. */
export function friendlyMessage(err: unknown, doing = 'That'): string {
  return friendlyError(err, doing).body;
}
