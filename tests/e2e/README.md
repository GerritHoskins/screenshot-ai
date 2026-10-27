# Desktop end-to-end tests

These Vitest suites use Playwright's Electron driver to launch the real production bundle and interact with its renderer/preload bridge.

## Run

```sh
npm ci
npm run test:e2e
# Complete suite, including the build and unit tests:
npm test
```

The scripts build the app before launching it. When dependencies were installed with `--ignore-scripts`, install the Electron runtime and rebuild native dependencies first:

```sh
node node_modules/electron/install.js
npm run postinstall
```

On Linux, provide libsecret development headers for keytar installation and a display server; CI runs `xvfb-run --auto-servernum npm run test:e2e`.

## Isolation and coverage

- `fixture.cjs` gives each test app a disposable user-data directory beneath `.cache/e2e/` and checks that keytar loads in Electron.
- `setup.ts` launches the built main process, waits for the real preload, and delivers synthetic results through real main-to-renderer IPC.
- Suites cover startup/global shortcut registration, processing/cancellation, result/error rendering, HTML-injection/CSP defenses, and settings persistence/invalid-input rejection.
- Tests never initiate screen capture, call AI providers, or access real saved credentials.
- Electron launch failures are test failures, not silent skips. The CI workflow treats E2E failures as blocking.
- Node V8 coverage does not include code executed in the separate Electron processes.

Windows desktop tests have been run locally. OS-level screen selection, multi-monitor/DPI behavior, signing/installers, and macOS/Linux native behavior require their own verification.
