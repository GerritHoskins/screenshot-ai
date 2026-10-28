# @gerrithoskins/screenshot-ai-core

Shared screenshot analysis, OpenAI/Anthropic provider clients, prompts, retry/cancellation helpers, response types, and runtime validation for React Native, browsers, and Node.js.

This package has no runtime dependencies, Node-only imports, Electron APIs, or `Buffer` requirements. ESM, CommonJS, TypeScript declarations, and a React Native export are built from the same implementation. It contains no UI, screen capture, filesystem/repository loading, credential storage, or image decoding/cropping. Those features belong to the host app.

Version 0.1.0 is the initial package version. Check the [npm package listing](https://www.npmjs.com/package/@gerrithoskins/screenshot-ai-core) or the repository's GitHub Packages listing for registry availability. Releases require namespace ownership and appropriate registry permissions.

## Installation

From the npm registry:

```sh
npm install @gerrithoskins/screenshot-ai-core
```

For local testing, build and pack from the repository, then install the generated tarball in a consumer:

```sh
npm run build --workspace @gerrithoskins/screenshot-ai-core
npm pack --workspace @gerrithoskins/screenshot-ai-core --pack-destination .cache
npm install /absolute/path/to/gerrithoskins-screenshot-ai-core-0.1.0.tgz
```

## Analyze an image

```ts
import { analyzeImage, type ImageInput } from '@gerrithoskins/screenshot-ai-core';

const image: ImageInput = {
  base64: screenshotBase64, // Raw base64, without a data: URL prefix.
  mimeType: 'image/png',
};

const result = await analyzeImage(image, {
  provider: 'openai', // Or 'anthropic'.
  apiKey: userSuppliedApiKey,
  model: selectedVisionModel,
  timeoutMs: 30_000,
  maxRetries: 2,
});

if (result.success && result.data) {
  console.log(result.data.answer);
  console.log(result.data.codeBlocks);
} else {
  console.log(result.error?.code, result.error?.message);
}
```

The supported image MIME types are PNG, JPEG, WebP, and GIF. The host supplies correctly encoded bytes and MIME type; the package does not validate image pixels or convert formats. It preserves the validated answer, extracted text/code, structured results, and numeric confidence instead of replacing them with a summary.

`model` defaults to the configured provider default when omitted. Defaults do not guarantee that a model is available to a particular account. Requests use the host's `fetch` unless a compatible transport is supplied. The host runtime must provide standard web APIs including `AbortController` and timers.

### React Native

Obtain base64 bytes through your image picker, share extension, or native image adapter, then pass the same `ImageInput`. Do not import `fs`, `Buffer`, Electron, keytar, or sharp into the mobile app. The package's `react-native` export points to the ESM build and can be resolved by Metro.

```ts
import { analyzeImage } from '@gerrithoskins/screenshot-ai-core';

const controller = new AbortController();
const result = await analyzeImage(
  { base64: importedImageBase64, mimeType: 'image/jpeg' },
  {
    provider: 'anthropic',
    apiKey: userSuppliedApiKey,
    signal: controller.signal,
    fetch, // Optional: inject a compatible platform transport.
  },
);

// Call controller.abort() from the screen's cancel/unmount handler.
```

No shared provider secret should be embedded in a mobile or browser bundle. App-owned credentials should remain behind an authenticated backend; user-supplied credentials require suitable platform secure storage. Images, optional context, and prompts are sent to the selected provider. The host must obtain consent and apply its own context/secret policy before calling the package. The desktop app retains its context exclusions, secret scanning, and credential handling outside this core.

### Custom transport and cancellation

`FetchLike` accepts the request fields used by the providers and a response exposing `ok`, `status`, `headers.get()`, and `json()`. Standard `fetch` is assignable. A proxy transport must implement the provider protocol or translate it explicitly.

Caller cancellation aborts active requests and stops retries. Timeouts abort the underlying request, including body parsing, before another attempt starts. HTTP/parse failures expose safe error classifications instead of upstream bodies that may echo private input. The library does not log prompt, image, response, or credential payloads.

### Lower-level APIs

Use `OpenAIProvider`, `AnthropicProvider`, or `createProvider` when a host already prepares its own prompt:

```ts
import { OpenAIProvider } from '@gerrithoskins/screenshot-ai-core';

const provider = new OpenAIProvider({ apiKey: userSuppliedApiKey });
const response = await provider.complete('Return valid JSON with confidence.', image);
```

`analyzeImage` is the validated screenshot-analysis API. Generic provider completions return parsed JSON; hosts using arbitrary response schemas must validate that data themselves. Prompt builders, response/error types, JSON parsing helpers, and screenshot-analysis validators are available from the package root.

## Build and verify

Run these commands from the repository root after `npm ci`:

```sh
npm run build --workspace @gerrithoskins/screenshot-ai-core
npm run typecheck --workspace @gerrithoskins/screenshot-ai-core
npm run verify:package --workspace @gerrithoskins/screenshot-ai-core
```

`prepack` rebuilds the package, so packing does not rely on stale generated files. The verifier reviews the tarball allowlist, installs it in a temporary consumer outside this checkout, runs ESM/CommonJS and React Native-condition smoke tests without `Buffer`, and compiles independent ESM/CommonJS TypeScript consumers with Node ambient types disabled. It makes no paid provider calls. Physical-device React Native execution is a separate validation step.

For an optional check against actual native tooling, run `npm run verify:core:react-native` from the repository root. It installs pinned React Native 0.88.1 / Metro 0.87.2 tooling beneath `.cache/`, consumes a content-addressed copy of the tarball, checks native fetch assignability, and builds/runs mocked analysis from Android and iOS bundles without Node globals. React Native's strict declaration baseline currently has three upstream errors; adding this package introduces none. The separate package-only declaration checks have no errors. This does not run an emulator, device, or real provider call.

## Registry preparation

The package manifest intentionally contains no hardcoded `publishConfig.registry` and no credential-bearing `.npmrc`. The same reviewed package/version can be directed to either registry by an authorized release command:

```sh
# Run only after explicit release authorization and registry authentication.
npm publish --workspace @gerrithoskins/screenshot-ai-core --access public --registry https://registry.npmjs.org
npm publish --workspace @gerrithoskins/screenshot-ai-core --registry https://npm.pkg.github.com
```

For GitHub Packages consumers, map the lowercase scope to GitHub's registry and authenticate with the appropriate package-read permission. A scope mapping selects one registry for installs; it cannot simultaneously resolve the same package name from both. Keep authentication in user/CI configuration, not committed files.

GitHub Packages initially uses private visibility; set public visibility separately in GitHub if desired. npm public scoped packages require public access and authorized namespace ownership. See the official [npm publishing guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/) and [GitHub npm registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry) for authentication and visibility requirements.

The repository includes a manually triggered **Publish Core to GitHub Packages** workflow. It validates the checked-out package, publishes using the repository's temporary `GITHUB_TOKEN`, and verifies a clean registry install with both ESM and CommonJS imports. npm publication is a separate release action.

Desktop installers are separate artifacts and are not distributed by this library package. Package publishing does not start the Electron app or run its native-module install/rebuild scripts.

## License

[MIT](LICENSE), applying to the code distributed in this core package. This package license does not add a license grant to the rest of the repository.
