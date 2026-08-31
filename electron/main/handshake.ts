import { randomBytes } from 'node:crypto';

// Generated once per launch, kept in memory only — never written to disk or logged.
export function generateHandshakeToken(): string {
  return randomBytes(32).toString('hex');
}
