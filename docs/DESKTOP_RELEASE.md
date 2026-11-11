# Desktop release preparation

The desktop packages are unsigned test builds. Neither the packaging scripts nor the manual workflow publish releases. Signing, notarization, and installation acceptance remain separate release steps.

## Build on the target platform

Use the locked dependencies and Node.js 24. Run `npm ci`, `npm run lint`, `npm run typecheck`, and `npm test`, then package the already-built app with the command for the machine:

| Host | Command | Expected output in `release/` |
| --- | --- | --- |
| Windows x64 | `npm run package:unsigned -- --win --x64` | `ScreenshotAI-<version>-win-x64-setup.exe` |
| Windows ARM64 | `npm run package:unsigned -- --win --arm64` | `ScreenshotAI-<version>-win-arm64-setup.exe` |
| macOS Intel | `npm run package:unsigned -- --mac --x64` | `ScreenshotAI-<version>-mac-x64.dmg` and `.zip` |
| macOS Apple Silicon | `npm run package:unsigned -- --mac --arm64` | `ScreenshotAI-<version>-mac-arm64.dmg` and `.zip` |

`package:unsigned` passes `--publish never`, disables Windows signing, and sets macOS identity to null and notarization to false. `npm run package` also disables publishing but permits signing with an explicitly configured environment. A package command does not rebuild the JavaScript bundle; run `npm run build` after source changes.

Before packaging, `verify:packaging` checks the entitlements, packaging hook, and production entry points. The `afterPack` hook checks that unpacked keytar and target-specific sharp binaries exist; on Windows it also checks their PE architecture. A missing or foreign native module fails the build before installer creation.

Do not cross-build from a host-only `node_modules`: electron-builder rebuilds keytar, but sharp's optional binary package can still belong to the host. Prefer a native runner with a fresh `npm ci`. If cross-building, isolate the target dependencies and use the versions already recorded in the lockfile; do not alter dependencies or the lockfile to make packaging pass. See [sharp's cross-platform installation guidance](https://sharp.pixelplumbing.com/install/#cross-platform).

After packaging, check every expected output with `npm run verify:packaging -- --artifacts win x64` (substitute `win`/`mac` and `x64`/`arm64`). This checks non-empty files, not installability or signatures.

Required entitlements live in tracked `packaging/entitlements.mac.plist`, outside ignored build output. They match electron-builder 26's Electron/native-module defaults. This is a hardened-runtime configuration, not a screen-recording permission grant.

## Manual workflow

Once these changes are on GitHub's default branch, select **Actions → Prepare Desktop Release (unsigned) → Run workflow**, then choose the source ref. This calls the existing CI workflow, including lint, types, tests, core consumer verification, and security audit. It produces four separately named artifact downloads with seven-day retention.

The packaging jobs use `windows-latest` (x64), `windows-11-arm` (ARM64), `macos-15-intel`, and `macos-latest` (Apple Silicon), matching [GitHub's runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Each job installs its own native dependencies and checks both expected macOS files or the Windows installer before upload.

The workflow is manual, has read-only repository permissions, and has no release creation, tag push, npm publication, or signing-secret inputs. Ordinary CI uses the same unsigned packaging jobs. A successful workflow does not replace the platform acceptance checks below.

## Credentials for a future signed release

Do not add credentials to the unsigned workflow. Configure them only for a separately authorized signing run, using protected environment secrets or local secret storage. Never commit certificate/key files or print their values.

| Platform | Environment variables | Purpose |
| --- | --- | --- |
| macOS signing | `CSC_LINK`, `CSC_KEY_PASSWORD` | Developer ID Application certificate (`.p12`) and its password |
| macOS notarization, Apple ID option | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Authentication for Apple's notarization service |
| macOS notarization, API-key alternative | `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | With the installed builder version, provide the `.p8` file path to `APPLE_API_KEY`; materialize it only in protected temporary storage |
| Windows certificate signing | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Supported Windows signing certificate and password; the builder also supports `CSC_LINK`/`CSC_KEY_PASSWORD` as fallbacks |

Use one notarization authentication method. A certificate held in hardware or a cloud signing service needs that service's setup instead of an exported certificate file. See the versioned [code-signing reference](https://www.electron.build/v26/docs/features/code-signing/) and [Windows signing guide](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).

For macOS, keep hardened runtime and the entitlements enabled, use a Developer ID identity, and verify the result with `codesign --verify --deep --strict`, `spctl --assess --type exec`, and `xcrun stapler validate` against the built app. Missing notarization credentials can cause this installed builder version to skip notarization, so build success alone is insufficient. See the [notarization guide](https://www.electron.build/v26/docs/features/code-signing/notarization/). On Windows, verify the app and installer with `Get-AuthenticodeSignature` and the intended publisher identity. These steps have not been performed here.

## Verification record — 2026-11-06

Local verification used Windows x64, Node 26.3.0, npm 11.1.0, Electron 45.0.0, and electron-builder 26.18.0. CI is configured for Node 24 but has not been dispatched for these changes.

| Check | Result |
| --- | --- |
| Lint, TypeScript, production build | Passed |
| Unit tests | 222 passed |
| Electron integration tests | 16 passed outside the Windows execution sandbox, using isolated profiles and fake keychain methods; sandboxed launch failed before startup |
| Input/output checks | Required build files passed; a missing installer was correctly rejected |
| Windows x64 NSIS | Built unsigned; packaged keytar loaded and sharp produced a synthetic PNG in the packaged Electron runtime |
| Windows ARM64 NSIS | Built unsigned using isolated locked ARM64 production dependencies; native-module architecture checks passed; runtime unverified on this x64 host |
| Incorrect ARM64 package | The new hook rejected a real cross-build containing x64 sharp |
| macOS Intel / Apple Silicon packages | Not built on this Windows host; native runner verification pending |
| Windows install / installed GUI launch / upgrade / uninstall | Not run; installer lifecycle remains unverified |
| macOS install / launch / upgrade / uninstall | Not run; no macOS acceptance environment used |
| Signing / notarization / public release | Not performed |

The final `npm test` run passed all 238 tests across 22 files with no skipped tests. Both installer signatures were checked with `Get-AuthenticodeSignature` and reported `NotSigned`, as intended.

| Installer | SHA-256 |
| --- | --- |
| `ScreenshotAI-0.1.0-win-x64-setup.exe` | `4D1D8DBAF240D3404F72699B809BE024CEA7006B5953ADD57F2632A99EC71321` |
| `ScreenshotAI-0.1.0-win-arm64-setup.exe` | `0606590D1095B86399B99FBF3E00CB75570DBF5DF3AE11CCBC306C182589CF3A` |

The successful x64 build used `npm run package:unsigned -- --win --x64 '-c.directories.output=release/verified-x64'` after an earlier extraction directory became locked. The ARM64 staging directory received copies of the package manifests, packaging resources, scripts, and built desktop/core outputs, followed by `npm ci --omit=dev --ignore-scripts --cpu=arm64 --os=win32 --no-audit --no-fund`. Its build used `npm run package:unsigned -- --win --arm64 '-c.electronVersion=45.0.0'`; the explicit version matches the installed/locked Electron runtime, since staging omits dev dependencies. The two validated installers were copied to `release/`. Project dependencies and the lockfile were unchanged.

## Remaining platform acceptance

Use a disposable OS account or VM for each architecture and record the package hash, OS version, and results:

1. Install the matching package. On Windows, check install-directory selection and desktop/Start-menu shortcuts; on macOS, install from the DMG and separately test the ZIP.
2. Launch the installed app, open Settings, save a non-secret setting, quit, and relaunch. Confirm that the value persists and there is no native-module load error. Do not enter real credentials or initiate screen capture for this smoke test.
3. Install a previous accepted version, save a setting, then install the candidate over it. Confirm replacement, version, shortcuts, and preserved settings. A same-version reinstall is not proof of upgrade behavior.
4. Uninstall/remove the app and check application files and shortcuts. Record retained settings or credentials without reading or deleting personal data. Confirm a subsequent reinstall launches.
5. Repeat signature/Gatekeeper/SmartScreen checks with the separately signed candidate before public distribution. Unsigned test packages do not prove signed-release acceptance.
