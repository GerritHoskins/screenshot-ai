# Screenshot AI verification
Read README.md, package.json, the affected desktop/core package and relevant tests.
Use synthetic screenshots and fake provider transports. Do not capture the user's screen,
read OS keychain secrets, test real keys, invoke OAuth or send context to vendors by default.
Choose current commands by scope: npm run lint, npm run typecheck, npm run test:unit,
npm run test:core, npm run test:e2e and npm run build. Run shared-core builds/checks
sequentially because they write the same output. Inspect Electron E2E fixtures before launch.
npm run verify:core validates package consumers; inspect its install behavior first.
npm run verify:core:react-native downloads tooling and performs native bundling, so it
requires approved environment/network setup. Installer signing, package publication and
real-device/native-capture acceptance are separate actions, never incidental verification.
Review secret/context filtering, capture consent, redaction, credential-storage boundaries,
cancellation and provider errors where affected. Never log screenshot pixels, keys or prompts.
Native-module rebuilds and dependency changes need scope approval; do not modify lockfiles
to work around an environment failure. A build does not prove OS capture/permission behavior.
Publication target: GitHub GerritHoskins/screenshot-ai. No npm or installer publication.
