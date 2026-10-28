const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const repository = path.resolve(root, '../..');
const cacheRoot = path.join(repository, '.cache', 'core-package-verify');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this verifier through npm run verify:package');
fs.mkdirSync(cacheRoot, { recursive: true });
const workspace = fs.mkdtempSync(path.join(cacheRoot, 'run-'));

function npm(args, cwd) {
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, npm_config_update_notifier: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function node(args, cwd) {
  return execFileSync(process.execPath, args, {
    cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const packOutput = npm(['pack', '--json', '--pack-destination', workspace], root);
// npm may forward prepack output ahead of its JSON report.
const reportStart = packOutput.lastIndexOf('\n[');
const packed = JSON.parse(reportStart < 0 ? packOutput : packOutput.slice(reportStart + 1))[0];
const files = packed.files.map(file => file.path);
assert(files.includes('dist/esm/index.js'));
assert(files.includes('dist/cjs/index.js'));
assert(files.includes('dist/esm/index.d.ts'));
assert(files.includes('dist/cjs/index.d.ts'));
assert(files.every(file => file.startsWith('dist/') || ['package.json', 'README.md', 'LICENSE'].includes(file)), 'Unexpected source, test, or private material in the tarball');
assert(files.every(file => !file.includes('node_modules') && !file.endsWith('.map')));
for (const file of files.filter(file => /\.(?:js|ts)$/.test(file))) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function inspect(node) {
    if (ts.isIdentifier(node)) assert(!['Buffer', 'NodeJS', 'process', '__dirname', '__filename'].includes(node.text), 'Node-only global in distributed file: ' + file);
    ts.forEachChild(node, inspect);
  }
  inspect(ast);
  assert(!/(?:from\s*|require\s*\(|import\s*\()['"](?:node:|electron|keytar|sharp|fs(?:\/|['"])|path(?:\/|['"]))/m.test(source), 'Platform-only import in distributed file: ' + file);
}

// Outside the checkout: an accidental ../../src import or parent node_modules
// resolution must fail instead of hiding a broken published artifact.
const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-ai-core-consumer-'));
fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'core-tarball-consumer', version: '1.0.0', private: true, type: 'module' }));
npm(['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--cache', path.join(cacheRoot, 'npm'), path.join(workspace, packed.filename)], consumer);

const smokeBody = `
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(typeof core.analyzeImage === 'function', 'Missing public analyzer');
assert(typeof core.OpenAIProvider === 'function', 'Missing provider');
const payload = { answer: 'portable answer', text: 'sample', codeBlocks: [{ language: 'js', code: 'const n = 1;' }], confidence: 0.8 };
const result = await core.analyzeImage({ base64: 'aGVsbG8=', mimeType: 'image/png' }, {
  provider: 'openai', model: 'fixture-model', apiKey: 'sk-local-fixture-only', maxRetries: 0,
  fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 2, completion_tokens: 3 } }) }),
});
assert(result.success, JSON.stringify(result.error));
assert(result.data.answer === 'portable answer', 'Answer was dropped');
assert(result.data.codeBlocks[0].code === 'const n = 1;', 'Code was dropped');
assert(result.data.confidence === 0.8, 'Numeric confidence changed');
`;
const esm = `import * as core from '@gerrithoskins/screenshot-ai-core';\n${smokeBody}`;
fs.writeFileSync(path.join(consumer, 'esm.mjs'), esm);
fs.writeFileSync(path.join(consumer, 'cjs.cjs'), `(async () => { const core = require('@gerrithoskins/screenshot-ai-core');\n${smokeBody}\n})().catch(error => { console.error(error); process.exitCode = 1; });`);
fs.writeFileSync(path.join(consumer, 'react-native.mjs'), `globalThis.Buffer = undefined;\nconst location = import.meta.resolve('@gerrithoskins/screenshot-ai-core');\nif (!location.endsWith('/dist/esm/index.js')) throw new Error('Wrong React Native entry');\nconst core = await import('@gerrithoskins/screenshot-ai-core');\n${smokeBody}`);
node(['esm.mjs'], consumer);
node(['cjs.cjs'], consumer);
node(['--conditions=react-native', 'react-native.mjs'], consumer);

// Compile against only standard web globals. No repository aliases or Node
// ambient types can accidentally make the installed public contract compile.
const typeFixture = `import { analyzeImage, OpenAIProvider, type ImageInput, type FetchLike } from '@gerrithoskins/screenshot-ai-core';
const image: ImageInput = { base64: 'aGVsbG8=', mimeType: 'image/png' };
const transport: FetchLike = fetch;
const provider = new OpenAIProvider({ apiKey: 'sk-local-fixture-only', fetch: transport });
void provider.complete('Return JSON', image);
void analyzeImage(image, { provider: 'openai', apiKey: 'sk-local-fixture-only', fetch: transport });
`;
fs.writeFileSync(path.join(consumer, 'consumer.mts'), typeFixture);
fs.writeFileSync(path.join(consumer, 'consumer.cts'), typeFixture);
fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
  target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'], types: [], strict: true, noEmit: true, skipLibCheck: false,
}, include: ['consumer.mts', 'consumer.cts'] }));
node([require.resolve('typescript/bin/tsc'), '--project', path.join(consumer, 'tsconfig.json')], consumer);

console.log('Package verified: allowlisted tarball; independent ESM/CommonJS runtime and declarations; React Native export without Buffer');
console.log('Artifact: ' + path.relative(repository, path.join(workspace, packed.filename)));
const resolvedConsumer = fs.realpathSync(consumer);
if (path.dirname(resolvedConsumer) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolvedConsumer).startsWith('screenshot-ai-core-consumer-')) {
  throw new Error('Refusing to clean a consumer outside the temporary test directory');
}
fs.rmSync(resolvedConsumer, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
