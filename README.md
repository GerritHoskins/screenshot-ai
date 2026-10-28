# ScreenshotAI

Capture a region of your screen and get AI answers, extracted text, and code insights with OpenAI or Anthropic.

Use it to understand an error message, pull text or code from a screenshot, or ask for an explanation of what you are looking at. You bring your own API key and choose the provider and model.

**ScreenshotAI is an early-stage desktop app.** Follow the source setup below to try it. Developers can also use the published [analysis core](#use-the-analysis-core-in-your-own-app) in their own applications.

## What you can do

- Select a screen region with the **Capture** button or a global keyboard shortcut.
- Read an answer alongside extracted text, code blocks, and structured findings.
- Run the analysis again or provide feedback for a revised response.
- Copy results as text, Markdown, or JSON, or save a JSON file.
- Customize the analysis prompt and optionally include project context from a local folder, GitHub, or GitLab.

## Get started

You will need:

- **Node.js 24.x and npm** to run the app from source. See [package.json](package.json) for other supported Node.js versions.
- An **OpenAI or Anthropic API key** with access to a vision-capable model.
- An internet connection. Analysis uses your provider account and may incur charges.

Clone the repository and start the app:

```sh
git clone https://github.com/GerritHoskins/screenshot-ai.git
cd screenshot-ai
npm ci
npm run dev
```

On Linux, install libsecret development headers before `npm ci` (for example, `sudo apt-get install libsecret-1-dev` on Ubuntu/Debian). Native dependencies may also require your operating system's build tools.

### Your first analysis

1. Open **Settings → Providers** and choose a provider and model available to your account.
2. In **API Keys**, enter your key, click **Save**, and use **Test** to check it.
3. Return to the main window and click **Capture**, or press **Ctrl+Shift+S** on Windows/Linux or **Cmd+Shift+S** on macOS.
4. Drag to select the region you want to analyze. Press **Esc** to cancel the selection.
5. Read the result, copy the parts you need, or use **Export** to save a JSON file.

**Completing the selection starts analysis immediately and sends the selected image to your chosen provider.** Check what is visible before selecting a region.

### Customize your results

In **Settings → Prompt**, enable a custom prompt to guide the kind of answer you want, such as explaining an error or extracting code.

For answers that need project details, open **Settings → Context**, enable context, and add a local folder or repository source. Review the included file tree, file contents, exclusions, and available preview before running an analysis. Context is disabled by default.

GitHub/GitLab connections require authentication. OAuth connections additionally require a registered client ID configured through `SCREENSHOT_AI_GITHUB_CLIENT_ID` or `SCREENSHOT_AI_GITLAB_CLIENT_ID` in the environment used to launch the app.

## Privacy

- Your selected screenshot and analysis prompt are sent to the AI provider you choose. Enabled project context can also send filenames and file contents. Repository integrations contact GitHub or GitLab.
- Desktop API keys use the operating system's credential store through `keytar`.
- Detected secrets in project context or custom prompts block submission. Secret detection is heuristic and does not inspect screenshot pixels; review sensitive material yourself.
- Raw prompts and analysis results are not logged.

Review AI-generated answers before relying on them, especially code changes or suggested fixes.

## Current limitations

- Windows capture uses a primary-monitor fallback; multiple monitors and different display scaling settings may behave differently.
- **Export Markdown file** currently copies the report to the clipboard. Use **Copy report (Markdown)** to paste it into your preferred editor, or export JSON to save a file.
- macOS/Linux screen capture and permissions, desktop installers, and signing have not been fully validated.
- There is no mobile app yet. The shared core is available for building one; mobile UI, image input, and secure credential storage belong to the host app.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| API key test or analysis fails | Check the selected provider, API key, model access, account quota, and internet connection. |
| Capture is denied or returns no image | Check screen-capture permissions in your OS, then restart the app. |
| Native-module or `keytar` ABI error | Run `npm run rebuild`, then restart the app. |
| Electron is missing after installing with scripts disabled | Run `node node_modules/electron/install.js`, then `npm run postinstall`. |
| Context submission is blocked | Review the reported source and remove sensitive material or exclude the affected files. |

## Use the analysis core in your own app

The MIT-licensed **`@gerrithoskins/screenshot-ai-core`** package provides the same analysis logic for React Native, browsers, and Node.js. It has no runtime dependencies and includes ESM, CommonJS, and TypeScript declarations.

```sh
npm install @gerrithoskins/screenshot-ai-core
```

Pass a screenshot as raw base64, without a `data:` URL prefix, and supply the user's API key:

```ts
import { analyzeImage } from '@gerrithoskins/screenshot-ai-core';

const result = await analyzeImage(
  { base64: screenshotBase64, mimeType: 'image/png' },
  { provider: 'openai', apiKey: userSuppliedApiKey },
);

if (result.success && result.data) {
  console.log(result.data.answer);
} else {
  console.error(result.error?.message);
}
```

The host app supplies image capture/import, credentials, and any context filtering. Never embed a shared provider secret in a browser or mobile bundle.

See the [core package guide](packages/core/README.md) for image formats, Anthropic support, cancellation, custom transports, React Native integration, and GitHub Packages configuration. The package is available on [npm](https://www.npmjs.com/package/@gerrithoskins/screenshot-ai-core) and [GitHub Packages](https://github.com/GerritHoskins/screenshot-ai/pkgs/npm/screenshot-ai-core).

## Development

This repository is an npm workspace. The Electron app lives in `apps/desktop`, desktop services and adapters live in `src`, and the portable library lives in `packages/core`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the desktop app with live development builds |
| `npm run build` | Build the desktop app and shared core |
| `npm run lint` | Check source lint rules |
| `npm run typecheck` | Check TypeScript types |
| `npm test` | Build and run unit and Electron integration tests |
| `npm run test:core` | Run shared-core and adapter tests |
| `npm run verify:core` | Verify the packed library in independent consumers |
| `npm run verify:core:react-native` | Download isolated React Native tooling and check native types and Android/iOS Metro bundles |

Run package checks sequentially because they rebuild the same core output. The React Native check uses mocked analysis; it does not run on a device or contact a live AI provider.

For local desktop packaging, run `npm run build` followed by `npm run package`. Installer output goes to `release/`; distribution and platform signing still require separate validation.

## License

The reusable core package is [MIT licensed](packages/core/LICENSE). That license applies to the core package; the rest of the repository does not currently declare a license.
