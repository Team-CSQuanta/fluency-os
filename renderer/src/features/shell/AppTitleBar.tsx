import type { CSSProperties } from 'react';

interface AppTitleBarProps {
  screenTitle: string;
}

export function AppTitleBar({ screenTitle }: AppTitleBarProps) {
  return (
    <div
      className="flex h-[34px] flex-none items-center justify-between border-b border-line2 bg-bg2 pl-[11px] select-none"
      style={{ zIndex: 40, WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <div className="flex items-center gap-[9px]">
        <img src="/icon.png" alt="" className="h-[16px] w-[16px]" />
        <span className="font-sans text-[11.5px] font-semibold tracking-[0.01em] text-tx">FluencyOS</span>
        <span className="font-mono text-[10.5px] text-tx3">— {screenTitle}</span>
      </div>
      <div className="flex h-[34px] items-stretch" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
        <button
          onClick={() => window.fluencyos.minimizeWindow()}
          className="grid w-[44px] place-items-center font-mono text-[13px] text-tx2 hover:bg-line2"
        >
          –
        </button>
        <button
          onClick={() => window.fluencyos.maximizeWindow()}
          className="grid w-[44px] place-items-center font-mono text-[10px] text-tx2 hover:bg-line2"
        >
          □
        </button>
        <button
          onClick={() => window.fluencyos.closeWindow()}
          className="grid w-[44px] place-items-center font-mono text-[12px] text-tx2 hover:bg-[#c0392b] hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
