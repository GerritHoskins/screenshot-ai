# ScreenshotAI

An Electron desktop app that turns selected screenshots into AI answers, extracted text, code insights, and structured results using OpenAI or Anthropic.

**Status: prototype, version 0.1.0.** Local security/privacy fixes and automated desktop regression tests are implemented. Installer signing, distribution, and cross-platform native capture still need verification. There is no React Native app or independently publishable core package yet. See the [audit and remediation](#repository-audit-2026-10-27).

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
| `npm run package` | Invoke electron-builder; configured installer output is `release/` |
| `npm run lint` | Run ESLint on `src/` and `tests/` |
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
src/providers              Active provider clients and retry/timeout helpers
src/context                Local and remote repository context loading/cache
src/security               Active keytar integration, auth, security utilities
src/settings               Versioned settings schema/store
src/types                  Shared response types and runtime validation
packages/core/src          Partial, separate analysis implementation
tests                      Unit tests and Electron test harness
```

The active path is **capture → desktop AnalysisService → root `src/providers` → provider API → renderer**. `electron.vite.config.ts` maps the desktop aliases to root `src/`. The similar provider, prompt, type, logging, and credential files under `apps/desktop/src/` and `packages/core/src/` are not automatically the active implementation.

This is a single root package with app/core directories, not a configured package workspace. The partial core has a different response-normalization path and does not yet define the desktop application's shared public API.

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
| `npm test` | Builds first, then runs unit and actual Electron desktop tests |
| `npm run test:coverage` | Builds and runs the suite with V8 coverage |
| `npm audit` | Zero reported advisories after the upgrades |
| `npm run postinstall` | Rebuilt native dependencies; desktop fixture also loads keytar as an ABI smoke check |

Unit regressions exercise the actual analysis/context/provider/IPC paths, including outgoing payload privacy, secret blocking, cache credential changes, capture concurrency, and renderer formatting. Exclusion tests use the production matcher.

The E2E harness uses Playwright to launch the built Electron app with a disposable profile under `.cache/e2e/`. It tests the real preload bridge, UI state, result/error rendering, settings persistence, rejection of invalid IPC inputs, and native CSP enforcement. It does not take screenshots of the user's desktop, call paid AI providers, or read/write real credentials. Native screen selection, DPI/multiple monitors, macOS/Linux behavior, and signing/installer behavior remain manual or cross-platform validation work. Coverage from the Node runner does not instrument the separate Electron processes.

CI source now uses Node.js 24, runs Linux E2E under Xvfb, and enforces E2E and dependency audit failures. These workflow edits have not been pushed or executed on GitHub.

### Further improvements

1. Verify native capture on Windows at different DPI settings and with multiple monitors, plus macOS permissions and Linux desktop behavior.
2. Complete release engineering: the manifest still references an absent macOS entitlements file, and the installer artifact-upload paths still need reconciliation with the `release/` output directory. Signing, notarization, installer smoke tests, and updates remain unverified.
3. Consolidate the remaining parallel provider, response, settings, and core implementations before making a public library contract.
4. Complete Markdown file export and improve keyboard, focus, and screen-reader behavior.
5. Consider explicit outgoing-context review, request-cost information, and opt-in history with retention/deletion controls.

No package, installer, or GitHub release was published.

## React Native feasibility

**Yes: an Android/iOS version is feasible as a new client sharing a refactored TypeScript core.** This is an architectural assessment, not a verified mobile port. The current renderer uses DOM APIs and HTML/CSS rather than React; it must be rewritten with React Native components.

| Area | Reuse or replacement |
| --- | --- |
| Prompts, response types, validation, retry policy | Reuse after consolidating the parallel implementations |
| Provider request/response logic | Share through an injected transport; replace Node `Buffer` assumptions with a base64 image plus MIME type or a portable byte interface |
| Electron windows, IPC, global shortcut, screen overlay | Replace with mobile navigation, explicit image input, and native integrations |
| `sharp` processing and `keytar` | Replace with mobile image-processing and secure-storage adapters |
| Filesystem/workspace context | Redesign around imported files or explicitly selected remote repositories; desktop paths do not transfer |
| Clipboard, export, settings/cache | Implement mobile adapters with suitable permissions and retention behavior |

Recommended first version: **import or share a screenshot → preview/crop → explicitly submit → display/copy/share results**. Start with picker-based import; receiving screenshots from another app requires platform share integration and an iOS share extension. Keep system-wide live capture as a separate native feasibility spike.

On Android, live device/app capture uses [MediaProjection](https://developer.android.com/media/grow/media-projection), requires consent for each session, and has foreground-service requirements for apps targeting Android 14+. On iOS, screen capture requires Apple-native APIs and system permission flows; validate API availability against the chosen minimum OS. Apple's current [ScreenCaptureKit documentation](https://developer.apple.com/documentation/ScreenCaptureKit?changes=l_4) describes the newer capture path replacing ReplayKit streaming, so a blanket ReplayKit-only design would be premature.

[React Native native modules](https://reactnative.dev/docs/native-platform) can bridge platform features. Never embed a shared provider secret in the mobile bundle: use an authenticated backend for app-owned credentials, or secure OS storage for user-supplied credentials, following the [React Native security guidance](https://reactnative.dev/docs/security).

Suggested implementation sequence: stabilize/extract the core, prove one imported-image analysis on both platforms, add secure credentials and export, then add share integration and evaluate live capture on real devices. No percentage of code reuse or delivery estimate is established by this audit.

## npm and GitHub Packages feasibility

**Both registries are possible after package preparation; this checkout is not ready to publish.** The most useful registry artifact would be a reusable analysis core. Desktop installers should be distributed as tested release assets separately.

Current blockers:

- The root manifest has `private: true`, which [prevents npm publication](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#private).
- `packages/core` has no manifest, public entry point, declaration build, or independent tests. It is not an installable package.
- The root `main` starts an Electron application; there is no library `exports` contract or CLI `bin` entry. An npm install would also encounter the desktop `postinstall` script and native dependencies.
- There is no top-level npm `files` allowlist or `.npmignore`. The nested `build.files` only configures electron-builder. The dry run included development/planning material as well as built output; a successful pack is not evidence of publish readiness.
- No project license file or `license` field is present. The owner must choose the intended distribution/reuse terms before release.
- Repository metadata, registry routing, authentication, versioning, and package-release workflows are not configured.

### Recommended package shape

Keep the desktop/root package private and prepare `packages/core` as a separate package, for example `@gerrithoskins/screenshot-ai-core`. This is a suggested name; npm namespace ownership and availability have not been checked.

Before publication, define its API and response schema, remove Electron/Node-only assumptions, emit JavaScript and declarations, declare `exports`/`types`, allowlist only distributable files, add license/repository metadata, and test the packed tarball in clean Node and React Native consumers. Keep desktop install/rebuild scripts out of the library.

| Destination | Requirements and intended use |
| --- | --- |
| npm registry | A publishable manifest, available name/authorized scope, authentication, and public access settings where appropriate. Use `--access public` explicitly for a public scoped release. See [npm publishing guidance](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/). |
| GitHub Packages npm registry | A lowercase scoped name such as `@gerrithoskins/screenshot-ai-core`, `https://npm.pkg.github.com` registry routing, and repository association. Actions can publish with `GITHUB_TOKEN` and `packages: write`; consumers need registry/auth setup, including for public npm packages. See [GitHub registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry). |
| GitHub Releases | Tested Windows/macOS installers produced by electron-builder; this is distinct from the GitHub Packages npm registry. |

The same scoped library/version can be released to both npm registries using explicit registry selection. Consumers must choose a registry mapping for the scope. A hardcoded GitHub `publishConfig.registry` should not accidentally route the npmjs release to GitHub. For npm CI publication, consider [trusted publishing with OIDC](https://docs.npmjs.com/trusted-publishers/); it has its own Node/npm and workflow requirements beyond the existing CI configuration.

The release gate should include passing checks, a reviewed `npm pack --dry-run`, an installation test of the actual tarball, and explicit publication authorization. No package, installer, or GitHub release was published during this audit.

## Suggested GitHub About metadata

**Description:**

> AI-powered screenshot analysis for desktop: capture a region and get answers, extracted text, and code insights with OpenAI or Anthropic.

**Topics:**

`electron`, `typescript`, `screenshot`, `screen-capture`, `image-analysis`, `artificial-intelligence`, `openai`, `anthropic`, `desktop-app`, `developer-tools`

React Native and npm-library topics should be added when those deliverables exist. These suggestions have not been applied to the GitHub repository settings.
