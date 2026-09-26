import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), noZodInBundle()],
  resolve: {
    // "@/components/ui/button" etc. — the alias shadcn/ui components use.
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    // In development the API runs separately on :3000; proxying keeps the browser on one origin.
    // In production the API serves the built app itself, so no proxy (or CORS) is needed.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});

/**
 * Fails the build if Zod reaches the browser. Shared's schemas build Zod objects as their module
 * loads, which tree-shaking can't remove, so importing one value from such a module (rather than a
 * type) quietly ships all of Zod to every visitor.
 */
function noZodInBundle(): Plugin {
  return {
    name: 'no-zod-in-bundle',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const zodModule = chunk.moduleIds.find((id) => /[\\/]node_modules[\\/]zod[\\/]/.test(id));
        if (zodModule) {
          this.error(
            `Zod is in the web bundle: chunk ${chunk.fileName} contains ${path.relative(import.meta.dirname, zodModule)}. ` +
              'Import only types or Zod-free helpers from @label-extractor/shared.',
          );
        }
      }
    },
  };
}
