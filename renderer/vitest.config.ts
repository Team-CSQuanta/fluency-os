import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// The app's own Vite config (for the `@/` alias), plus where the tests are.
// Node, not a browser: what is tested here is the logic kept out of the
// components precisely so it could be checked without a DOM, a microphone
// or a backend.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  }),
);
