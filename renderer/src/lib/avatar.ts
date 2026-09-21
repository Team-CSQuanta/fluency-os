import { fileUrl } from '@/lib/apiClient';

/** Where a profile picture is served from. The URL does not change when the
 * picture does, so a version rides in the query string to defeat the cache. */
export function avatarUrl(userId: string, version = 0): string {
  return fileUrl(`/users/${encodeURIComponent(userId)}/avatar?v=${version}`);
}
