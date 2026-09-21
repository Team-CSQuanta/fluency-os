import { fileUrl } from '@/lib/apiClient';

/** Where a reader's profile picture is served from.
 *
 * The URL does not change when the picture does, so a version rides along in
 * the query string: without it the browser keeps showing the old face until
 * the app is restarted.
 */
export function avatarUrl(userId: string, version = 0): string {
  return fileUrl(`/users/${encodeURIComponent(userId)}/avatar?v=${version}`);
}
