// Never log the handshake token or any secret value through this module.
export const logger = {
  info: (...args: unknown[]) => console.log('[fluencyos]', ...args),
  warn: (...args: unknown[]) => console.warn('[fluencyos]', ...args),
  error: (...args: unknown[]) => console.error('[fluencyos]', ...args),
};
