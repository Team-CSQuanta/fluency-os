import { session } from 'electron';

/** Hosts the embedded YouTube player needs to reach. Everything else is
 * untouched — this must not see the loopback backend's traffic. */
const EMBED_HOSTS = [
  'https://*.youtube-nocookie.com/*',
  'https://*.youtube.com/*',
  'https://*.googlevideo.com/*',
];

/** What the player is told it is embedded on.
 *
 * Measured, not guessed. An iframe inside this app sends no usable Referer —
 * in production the page is loaded with loadFile(), so its origin is file://,
 * and a file:// page sends none at all. YouTube answers that with "Video
 * player configuration error (153)" and never starts the player. With a
 * Referer set, the same embed plays:
 *
 *     no Referer set  -> embed loads, 0 media requests -> blocked
 *     Referer set     -> embed loads, 2 media requests -> plays
 *
 * A synthetic name rather than https://www.youtube.com/, which is both
 * dishonest and does not work — YouTube rejects it with error 152. This one
 * identifies the app and impersonates nobody; .local is reserved for exactly
 * this kind of non-public name.
 */
const APP_REFERRER = 'https://fluencyos.local/';

/** Give the embedded player a referrer so YouTube will start it.
 *
 * Registered once at startup. It only rewrites a header on requests already
 * going to YouTube — it cannot cause a request that would not otherwise
 * happen, and the Scene Challenge is off until the learner turns it on.
 */
export function registerSceneEmbedReferrer(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: EMBED_HOSTS },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, Referer: APP_REFERRER } });
    },
  );
}
