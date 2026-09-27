import { useEffect } from 'react';
import { api } from '@/lib/apiClient';
import { inQuietHours } from '@/lib/quietHours';
import { useAppStore } from '@/store/appStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import type { ReviewStatsOut } from '@/types/api';

/** First look a couple of minutes after launch, then every quarter hour. */
const FIRST_CHECK_MS = 2 * 60 * 1000;
const CHECK_MS = 15 * 60 * 1000;
/** At most one reminder in this long: a nudge, not a nag. */
const MIN_GAP_MS = 3 * 60 * 60 * 1000;
const LAST_SHOWN_KEY = 'fluencyos.reviewReminder.lastShown';

function lastShown(): number {
  try {
    return Number(localStorage.getItem(LAST_SHOWN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markShown(at: number): void {
  try {
    localStorage.setItem(LAST_SHOWN_KEY, String(at));
  } catch {
    // Without storage the gap only holds for this session — still a nudge.
  }
}

/** The review reminder behind Settings → Study → Notifications (and the
 * onboarding step that sets it up): a desktop notification when words are
 * due, while the app is open — minimised or behind other windows is fine.
 *
 * Silent when the learner is already looking at the app, during quiet hours,
 * when nothing is due, and within three hours of the last one. Clicking it
 * brings the window forward on the Review screen. */
export function useReviewReminder(): void {
  const userId = useAppStore((s) => s.currentUserId);
  const settings = useSettingsStore((s) => s.settings);
  const fetchSettings = useSettingsStore((s) => s.fetch);

  useEffect(() => {
    if (userId && !settings) void fetchSettings();
  }, [userId, settings, fetchSettings]);

  const enabled = settings?.notifications_enabled ?? false;
  const quietStart = settings?.quiet_hours_start ?? '22:00';
  const quietEnd = settings?.quiet_hours_end ?? '08:00';

  useEffect(() => {
    if (!userId || !enabled || typeof Notification === 'undefined') return;
    let cancelled = false;

    const check = async () => {
      if (cancelled || document.hasFocus()) return;
      const now = Date.now();
      if (inQuietHours(new Date(now), quietStart, quietEnd) || now - lastShown() < MIN_GAP_MS) return;
      let stats: ReviewStatsOut;
      try {
        stats = await api.get<ReviewStatsOut>(`/review/stats?user_id=${encodeURIComponent(userId)}`);
      } catch {
        return;
      }
      if (cancelled || stats.due_now < 1) return;
      markShown(now);
      const words = stats.due_now === 1 ? 'word is' : 'words are';
      const note = new Notification('Time for a quick review', {
        body: `${stats.due_now} ${words} due — a few minutes now keeps them from slipping.`,
      });
      note.onclick = () => {
        window.fluencyos?.focusWindow();
        useShellStore.getState().goScreen('review');
        note.close();
      };
    };

    const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
    const every = window.setInterval(() => void check(), CHECK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [userId, enabled, quietStart, quietEnd]);
}
