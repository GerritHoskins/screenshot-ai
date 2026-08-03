import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';

const rootSrc = resolve(__dirname, 'src');
const outDir = resolve(__dirname, 'dist');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(outDir, 'main'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'apps/desktop/src/main/index.ts'),
        },
        external: ['keytar'], // Externalize keytar - native module must not be bundled
      },
    },
    resolve: {
      alias: {
        '@': rootSrc,
        '@types': resolve(rootSrc, 'types'),
        '@providers': resolve(rootSrc, 'providers'),
        '@security': resolve(rootSrc, 'security'),
        '@logging': resolve(rootSrc, 'logging'),
        '@errors': resolve(rootSrc, 'errors'),
        '@prompts': resolve(rootSrc, 'prompts'),
        '@utils': resolve(rootSrc, 'utils'),
        '@context': resolve(rootSrc, 'context'),
        '@settings': resolve(rootSrc, 'settings'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(outDir, 'preload'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'apps/desktop/src/preload/index.ts'),
          overlay: resolve(__dirname, 'apps/desktop/src/preload/overlay.ts'),
          chooser: resolve(__dirname, 'apps/desktop/src/preload/chooser.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@': rootSrc,
        '@types': resolve(rootSrc, 'types'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'apps/desktop/src/renderer'),
    build: {
      outDir: resolve(outDir, 'renderer'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'apps/desktop/src/renderer/index.html'),
          overlay: resolve(__dirname, 'apps/desktop/src/renderer/overlay.html'),
          settings: resolve(__dirname, 'apps/desktop/src/renderer/settings.html'),
          chooser: resolve(__dirname, 'apps/desktop/src/renderer/chooser.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': rootSrc,
        '@types': resolve(rootSrc, 'types'),
        '@utils': resolve(rootSrc, 'utils'),
      },
    },
  },
});
