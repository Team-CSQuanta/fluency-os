/** Transport icons as inline SVG.
 *
 * These were text glyphs — "|◀", "▶|", "⛶", "🔊". Three problems that only
 * show up once the app is running: "|◀" wraps onto two lines because the bar
 * is a flex row and a pipe is a break opportunity, "🔊" renders as a colour
 * emoji that ignores the interface palette entirely, and the geometric shapes
 * land at different optical sizes in every font. SVG fixes all three and
 * inherits currentColor, so the hover and active states work.
 */

interface IconProps {
  size?: number;
}

function Svg({ size = 15, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const Back5Icon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 5 5 11l6 6" />
    <path d="M5 11h9a5 5 0 0 1 0 10h-3" />
  </Svg>
);

export const Forward5Icon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m13 5 6 6-6 6" />
    <path d="M19 11h-9a5 5 0 0 0 0 10h3" />
  </Svg>
);

export const PrevLineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 5 8 12l10 7V5Z" fill="currentColor" stroke="none" />
    <path d="M5 4v16" />
  </Svg>
);

export const NextLineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 5l10 7L6 19V5Z" fill="currentColor" stroke="none" />
    <path d="M19 4v16" />
  </Svg>
);

export const ReplayLineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 11a9 9 0 1 1 3 6.7" />
    <path d="M3 5v6h6" />
  </Svg>
);

export const VolumeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </Svg>
);

export const MutedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
    <path d="m16 9 5 6M21 9l-5 6" />
  </Svg>
);

export const PipIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
    <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const FullscreenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 9V4h5M21 9V4h-5M3 15v5h5M21 15v5h-5" />
  </Svg>
);

export const ExitFullscreenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
  </Svg>
);

export const SavedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3h10a1 1 0 0 1 1 1v16l-6-4-6 4V4a1 1 0 0 1 1-1Z" />
  </Svg>
);
