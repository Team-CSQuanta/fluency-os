import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: 'var(--sans)',
        mono: 'var(--mono)',
      },
      colors: {
        acc: 'var(--acc)',
        accSoft: 'var(--accSoft)',
        accLine: 'var(--accLine)',
        accSolid: 'var(--accSolid)',
        bg: 'var(--bg)',
        bg2: 'var(--bg2)',
        panel: 'var(--panel)',
        panel2: 'var(--panel2)',
        line: 'var(--line)',
        line2: 'var(--line2)',
        tx: 'var(--tx)',
        tx2: 'var(--tx2)',
        tx3: 'var(--tx3)',
        tile: 'var(--tile)',
        tileB: 'var(--tileB)',
      },
      boxShadow: {
        panel: 'var(--shadow)',
      },
      borderRadius: {
        panel: '10px',
        field: '7px',
      },
    },
  },
  plugins: [],
} satisfies Config;
