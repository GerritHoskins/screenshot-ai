# ScreenshotAI

An Electron desktop app that turns selected screenshots into AI answers, extracted text, code insights, and structured results using OpenAI or Anthropic.

**Status: prototype, version 0.1.0.** Security/privacy fixes and desktop regression tests are implemented. The MIT-licensed [analysis core](packages/core/README.md) is a reusable package for React Native, browsers, and Node.js. Installer signing, distribution, and cross-platform native capture still need verification; a mobile UI is not implemented.

## What is implemented

- Start a screen selection from the app or with `Ctrl+Shift+S` / `Cmd+Shift+S`.
- Analyze screenshots with a configurable OpenAI or Anthropic provider and model.
- Display answers, extracted text, code, structured results, and request metadata.
- Retry an analysis and provide feedback for a revised response.
- Configure API keys, custom prompts, and local/GitHub/GitLab context sources.
- Copy results and reports; save a JSON export through a file dialog.

Repository integrations need fixes described below. The Markdown file-export action currently copies the report to the clipboard instead of saving a file. Windows capture first uses a PowerShell/.NET fallback that captures the primary monitor; this path does not provide full multi-monitor parity.

## Development

Prerequisites:

- Node.js matching `engines` in `package.json` (22.14+, 24.x, or 26+ on the supported major lines) and npm. CI uses Node.js 24. Native-module installation may require an OS build toolchain and, on Linux, libsecret development headers.
- An OpenAI or Anthropic API key with access to the selected vision-capable model, and an internet connection for analysis. Provider charges apply.
- Operating-system screen-capture permission where required.

```sh
git clone https://github.com/GerritHoskins/screenshot-ai.git
cd screenshot-ai
npm ci
npm run dev
```

In Settings, select a provider and model, save your own API key, and then start a capture. The active analysis defaults in this checkout are `gpt-5.2` and `claude-sonnet-4-5-20250929`; these are source defaults, not a guarantee of model availability for your account.

The active credential implementation uses `keytar`. A native-module/ABI error may require `npm run rebuild`. The separate `safeStorage` implementation under `apps/desktop/src/security` is not the implementation selected by the build aliases.

The checked-in lockfile, `packageManager` declaration, and CI use npm. After installing dependencies with lifecycle scripts disabled, run `node node_modules/electron/install.js` and `npm run postinstall` before native desktop tests.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Electron with the Vite development server |
| `npm run build` | Compile main, preload, and renderer bundles into `dist/` |
| `npm run build:core` | Build the shared library as ESM/CommonJS with declarations |
| `npm run verify:core` | Pack and install the library in clean consumers; verify exports and types |
| `npm run verify:core:react-native` | Install isolated native test tooling and check React Native types plus Android/iOS Metro bundles |
| `npm run package` | Invoke electron-builder; configured installer output is `release/` |
| `npm run lint` | Run ESLint on root, desktop, core, tests, and configuration sources |
| `npm run typecheck` | Run the current TypeScript configuration |
| `npm run test:unit` | Run unit tests |
| `npm run test:e2e` | Run the existing Electron test suites |
| `npm run test:coverage` | Run tests with V8 coverage |

Run `npm run build` before `npm run package`; packaging does not build the app automatically. Installer creation, signing, notarization, and native behavior have not been verified by this audit.

## Architecture

```text
apps/desktop/src/main       Electron lifecycle, capture, analysis, settings IPC
apps/desktop/src/preload    Renderer-facing contextBridge APIs
apps/desktop/src/renderer   HTML/CSS/TypeScript user interface
src/providers              Desktop Buffer adapters for shared provider clients
src/context                Local and remote repository context loading/cache
src/security               Active keytar integration, auth, security utilities
src/settings               Versioned settings schema/store
src/types                  Compatibility exports of shared response types/validation
packages/core/src          Canonical portable providers, analysis, prompts, types
tests                      Unit tests and Electron test harness
```

The active path is **capture → desktop AnalysisService → root Buffer adapters → shared core provider → provider API → renderer**. The desktop service owns keychain access, repository context, and secret filtering. The shared package owns portable request, retry/cancellation, prompt, and response-validation logic. Compatibility modules delegate to that implementation.

This is an npm workspace. The desktop root remains private; `@gerrithoskins/screenshot-ai-core` has an independent manifest, public exports, declaration builds, MIT license, and a strict package-file allowlist. Desktop bundles include the portable code, so distribution does not depend on a workspace symlink.

## Privacy and security

Analysis sends the selected screenshot and generated prompt to the selected external AI provider. Enabled context sources can add repository filenames and source contents. Remote context loading also contacts GitHub or GitLab. This is not an offline inference application.

Context is disabled by default. Preview and analysis use the same loader, enforce global/per-source exclusions and content opt-outs, and respect the selected folder boundary. Detected secrets in context or custom prompts block submission; scanner matches are redacted, and raw prompts/results are not logged. Detection is heuristic and does not locally inspect screenshot pixels, so it cannot establish that a selected image or arbitrary text contains no secrets.

## Repository audit (2026-10-27)

The original audit examined checkout `4276f2f`. It found renderer HTML injection, unenforced context settings, secret transmission, overlapping captures/retries, broken validation, and 42 dependency advisory entries. The local remediation below addresses those findings; historical planning/status files still describe the earlier implementation.

### Security and privacy changes

- Escape model output before adding limited formatting; apply CSP to every renderer page and deny unexpected navigation, popups, and webviews.
- Validate IPC arguments, top-level sender frames, renderer URLs, and capture-window ownership.
- Use one context policy for preview and submission, merging baseline, global, and source exclusions. Explicitly disabled contents/sources cannot be restored through legacy folder fallback.
- Keep local reads within the selected folder, keep remote tree/content on the selected commit, and scope caches to privacy settings and account credentials.
- Block detected secrets before provider invocation or remote cache writes, including standalone GitHub tokens and custom prompts. Redact scanner matches and log payloads.
- Require current credentials before using private repository caches; discard fetch results after a disconnect or credential replacement.
- Abort actual provider requests on timeout and use a single bounded retry policy.
- Lock capture before waiting for selection and clean up only the owning window's handlers.
- Test API keys directly without replacing saved credentials. OAuth requires a registered client ID configured through `SCREENSHOT_AI_GITHUB_CLIENT_ID` / `SCREENSHOT_AI_GITLAB_CLIENT_ID`; placeholder IDs are no longer used.

### Validation results

Local checks use Node.js `v26.3.0` and npm `11.1.0` on Windows. Approved dependency upgrades include Electron, sharp, Vite/electron-vite, Vitest, and ESLint. Native dependencies were rebuilt for Electron 45.

| Check | Result |
| --- | --- |
| `npm run build` | Passed; emits main, preload, and all four renderer pages |
| `npm run lint` | Passed with the checked-in ESLint flat configuration |
| `npm run typecheck` | Passed; includes root, desktop, core, tests, and build/test configuration |
| `npm test` | Passed: 238 tests across 22 files, including actual Electron desktop tests |
| `npm run verify:core` | Passed: packed-library imports, strict declarations, contents allowlist, and React Native export |
| `npm run test:coverage` | Available; full extraction coverage has not been rerun |
| `npm audit` | Zero reported advisories after the upgrades |
| `npm run postinstall` | Rebuilt native dependencies; desktop fixture also loads keytar as an ABI smoke check |

Unit regressions exercise the actual analysis/context/provider/IPC paths, including outgoing payload privacy, secret blocking, cache credential changes, capture concurrency, and renderer formatting. Exclusion tests use the production matcher.

The E2E harness uses Playwright to launch the built Electron app with a disposable profile under `.cache/e2e/`. It tests the real preload bridge, UI state, result/error rendering, settings persistence, rejection of invalid IPC inputs, and native CSP enforcement. It does not take screenshots of the user's desktop, call paid AI providers, or read/write real credentials. Native screen selection, DPI/multiple monitors, macOS/Linux behavior, and signing/installer behavior remain manual or cross-platform validation work. Coverage from the Node runner does not instrument the separate Electron processes.

The security baseline was pushed as `192f55b`. CI source uses Node.js 24, runs Linux E2E under Xvfb, and enforces E2E and dependency audit failures. The core extraction adds packed-consumer verification. Cross-platform CI and installer validation remain separate from the local checks above.

### Further improvements

1. Verify native capture on Windows at different DPI settings and with multiple monitors, plus macOS permissions and Linux desktop behavior.
2. Complete release engineering: the manifest still references an absent macOS entitlements file, and the installer artifact-upload paths still need reconciliation with the `release/` output directory. Signing, notarization, installer smoke tests, and updates remain unverified.
3. Continue simplifying desktop settings and platform adapters around the shared library contract.
4. Complete Markdown file export and improve keyboard, focus, and screen-reader behavior.
5. Consider explicit outgoing-context review, request-cost information, and opt-in history with retention/deletion controls.

Core package releases are independent of desktop installers and GitHub release assets.

## React Native feasibility

**The shared analysis core is now extracted and consumable by React Native.** A mobile app still needs its own UI, image input, secure storage, and sharing adapters. The current desktop renderer uses DOM APIs and HTML/CSS rather than React Native components.

| Area | Reuse or replacement |
| --- | --- |
| Prompts, response types, validation, retry policy | Shared in the extracted package |
| Provider request/response logic | Shared through injectable fetch; portable input is base64 plus an explicit MIME type |
| Electron windows, IPC, global shortcut, screen overlay | Replace with mobile navigation, explicit image input, and native integrations |
| `sharp` processing and `keytar` | Replace with mobile image-processing and secure-storage adapters |
| Filesystem/workspace context | Redesign around imported files or explicitly selected remote repositories; desktop paths do not transfer |
| Clipboard, export, settings/cache | Implement mobile adapters with suitable permissions and retention behavior |

Recommended first version: **import or share a screenshot → preview/crop → explicitly submit → display/copy/share results**. Start with picker-based import; receiving screenshots from another app requires platform share integration and an iOS share extension. Keep system-wide live capture as a separate native feasibility spike.

On Android, live device/app capture uses [MediaProjection](https://developer.android.com/media/grow/media-projection), requires consent for each session, and has foreground-service requirements for apps targeting Android 14+. On iOS, screen capture requires Apple-native APIs and system permission flows; validate API availability against the chosen minimum OS. Apple's current [ScreenCaptureKit documentation](https://developer.apple.com/documentation/ScreenCaptureKit?changes=l_4) describes the newer capture path replacing ReplayKit streaming, so a blanket ReplayKit-only design would be premature.

[React Native native modules](https://reactnative.dev/docs/native-platform) can bridge platform features. Never embed a shared provider secret in the mobile bundle: use an authenticated backend for app-owned credentials, or secure OS storage for user-supplied credentials, following the [React Native security guidance](https://reactnative.dev/docs/security).

The optional native verification command consumes the packed library with React Native 0.88.1 / Metro 0.87.2. It checks native fetch assignability and builds/runs mocked analysis in Android/iOS Metro bundles without Node globals. Strict declaration checking finds three errors in React Native's own baseline declarations; adding this core introduces none. Separate clean ESM/CommonJS consumers verify the package declarations without errors. No emulator/device or live provider was used.

Next, implement screenshot import and a results UI on both platforms, then secure credentials/export and share integration. System capture requires a separate native validation step.

## Reusable core and registries

[Core package documentation](packages/core/README.md) includes the public API, React Native input/transport guidance, local tarball installation, and registry-specific release commands.

```ts
import { analyzeImage } from '@gerrithoskins/screenshot-ai-core';

const result = await analyzeImage(
  { base64: screenshotBase64, mimeType: 'image/png' },
  { provider: 'openai', apiKey: userSuppliedApiKey, model: selectedVisionModel },
);
```

The library has zero runtime dependencies, ESM/CommonJS entry points, TypeScript declarations, a React Native export condition, and an MIT license scoped to the core package. Host applications supply image input, network transport, secure credentials, and context/privacy policy. The desktop root stays private and retains capture, keychain, repository loading, and UI responsibilities.

### Local verification

Run sequentially because each package verification rebuilds its generated output:

```sh
npm run build:core
npm run test:core
npm run verify:core
# Optional: downloads isolated RN/Metro tooling into .cache/.
npm run verify:core:react-native
```

The package verifier installs the actual tarball outside this checkout and checks runtime imports, declarations, and the contents allowlist. Library packing never includes Electron/native dependencies, repository context, test fixtures, or development files.

### npm and GitHub Packages

The same scoped package can be directed to either registry. The manifest deliberately does not hardcode a registry, so publishing to one does not misroute the other.

| Destination | Remaining release setup |
| --- | --- |
| npm registry | Confirm ownership/availability of the `@gerrithoskins` namespace and package name, configure authentication or trusted publishing, then make an explicitly authorized public release. See [npm publishing guidance](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/). |
| GitHub Packages npm registry | Authenticate to `https://npm.pkg.github.com` with package-write permission. The lowercase scope and repository association are in the package manifest. Initial visibility is private; public visibility is a separate GitHub package setting. Consumers need scope mapping and package-read authentication. See [GitHub registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry). |
| GitHub Releases | Desktop installers remain separate release assets; publishing the core does not distribute the Electron app. |

Keep credentials in user/CI configuration. A registry scope mapping selects one registry for installation; use explicit registry selection for dual-registry releases. For npm CI releases, [trusted publishing with OIDC](https://docs.npmjs.com/trusted-publishers/) can avoid long-lived write tokens once configured by the owner. The manually triggered **Publish Core to GitHub Packages** workflow validates and publishes the checked-out core version using the repository's temporary `GITHUB_TOKEN`, then installs it from the registry to check both module formats. It does not publish to npm or create desktop releases.

## Suggested GitHub About metadata

**Description:**

> AI-powered screenshot analysis for desktop: capture a region and get answers, extracted text, and code insights with OpenAI or Anthropic.

**Topics:**

`electron`, `typescript`, `screenshot`, `screen-capture`, `image-analysis`, `artificial-intelligence`, `openai`, `anthropic`, `desktop-app`, `developer-tools`, `react-native`, `npm-package`

These suggestions have not been applied to the GitHub repository settings.
