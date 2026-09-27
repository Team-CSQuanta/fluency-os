import { useState } from 'react';
import { avatarUrl } from '@/lib/avatar';
import { useAppStore } from '@/store/appStore';

/** The signed-in learner's picture, small — beside their own messages.
 * Falls back to `fallback` when no picture is set, or when it fails to load. */
export function UserAvatar({ size = 28, fallback = 'you' }: { size?: number; fallback?: string }) {
  const user = useAppStore((s) => s.currentUser);
  const version = useAppStore((s) => s.avatarVersion);
  const [failed, setFailed] = useState(false);
  const showPicture = Boolean(user?.has_avatar) && !failed;

  return (
    <div
      className="grid flex-none place-items-center overflow-hidden rounded-full bg-tile font-mono text-[8px] font-semibold text-tx3"
      style={{ width: size, height: size }}
      title={user?.display_name ?? undefined}
    >
      {showPicture && user ? (
        <img
          src={avatarUrl(user.id, version)}
          alt=""
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        fallback
      )}
    </div>
  );
}
