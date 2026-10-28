// Optional networked compatibility check. Installs pinned test tooling only into
// .cache/, then consumes the actual core tarball rather than workspace sources.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const consumer = path.join(root, '.cache', 'react-native-core-consumer');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run verify:core:react-native');
fs.mkdirSync(consumer, { recursive: true });

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error('Compatibility check command failed: ' + command + ' ' + args.join(' '));
  }
  return result.stdout;
}

async function main() {
  run(process.execPath, [npmCli, 'run', 'build:core']);
  const packed = JSON.parse(run(process.execPath, [npmCli, 'pack', path.join(root, 'packages/core'), '--pack-destination', consumer, '--json', '--ignore-scripts']));
  const packedArchive = path.join(consumer, packed[0].filename);
  const digest = createHash('sha256').update(fs.readFileSync(packedArchive)).digest('hex').slice(0, 16);
  const archive = path.join(consumer, 'core-' + digest + '.tgz');
  fs.copyFileSync(packedArchive, archive);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'screenshot-ai-native-core-consumer', private: true,
    dependencies: {
      '@gerrithoskins/screenshot-ai-core': 'file:' + archive,
      'react-native': '0.88.1',
      react: '^19.3.0',
      '@types/react': '^19.1.1',
      '@react-native/metro-config': '0.88.1',
      '@react-native/typescript-config': '0.88.1',
      metro: '0.87.2',
    },
  }, null, 2));
  console.log('Installing isolated React Native 0.88.1 / Metro 0.87.2 consumer tooling...');
  process.stdout.write(run(process.execPath, [npmCli, 'install', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(root, '.cache/npm-install')], consumer));

  fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
    extends: '@react-native/typescript-config',
    compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, types: ['react-native'], lib: ['ES2022'], customConditions: ['react-native'] },
    files: ['consumer.ts'],
  }, null, 2));
  fs.writeFileSync(path.join(consumer, 'consumer.ts'), [
    "import { analyzeImage, type AnalyzeOptions, type FetchLike, type ImageInput } from '@gerrithoskins/screenshot-ai-core';",
    "import type { ImageSourcePropType } from 'react-native';",
    "const nativeImage: ImageSourcePropType = { uri: 'file:///fixture.png' };",
    "const transport: FetchLike = fetch;",
    "const image: ImageInput = { base64: 'eA==', mimeType: 'image/png' };",
    "const options: AnalyzeOptions = { provider: 'openai', apiKey: 'sk-test', fetch: transport, signal: new AbortController().signal };",
    'void nativeImage; void analyzeImage(image, options);',
  ].join('\n'));
  // Keep declaration checking enabled. Compare against a native-only baseline
  // so existing upstream RN declaration errors are reported, never confused
  // with package errors or hidden with skipLibCheck.
  fs.writeFileSync(path.join(consumer, 'native-baseline.ts'), [
    "import type { ImageSourcePropType } from 'react-native';",
    "const image: ImageSourcePropType = { uri: 'file:///fixture.png' }; void image;",
  ].join('\n'));
  const ts = require(path.join(root, 'node_modules/typescript'));
  function diagnostics(file) {
    const loaded = ts.readConfigFile(path.join(consumer, 'tsconfig.json'), ts.sys.readFile);
    if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
    const config = ts.parseJsonConfigFileContent({ ...loaded.config, files: [file] }, ts.sys, consumer, undefined, path.join(consumer, 'tsconfig.json'));
    if (config.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(config.errors, ts.createCompilerHost(config.options)));
    const program = ts.createProgram(config.fileNames, config.options);
    return ts.getPreEmitDiagnostics(program);
  }
  const baseline = diagnostics('native-baseline.ts');
  if (baseline.some(diagnostic => !diagnostic.file?.fileName.replace(/\\/g, '/').includes('/node_modules/react-native/'))) {
    throw new Error('React Native baseline has errors outside its own upstream declarations');
  }
  const diagnosticKey = diagnostic => [diagnostic.file?.fileName, diagnostic.start, diagnostic.code, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')].join('|');
  const baselineKeys = new Set(baseline.map(diagnosticKey));
  const introduced = diagnostics('consumer.ts').filter(diagnostic => !baselineKeys.has(diagnosticKey(diagnostic)));
  if (introduced.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(introduced, {
      getCanonicalFileName: name => name, getCurrentDirectory: () => consumer, getNewLine: () => '\n',
    }));
  }
  if (baseline.length) console.log('React Native upstream declaration baseline: ' + baseline.length + ' existing diagnostics; core introduces none (skipLibCheck remains false).');
  console.log('Passed: real React Native globals/types and native fetch assignability.');

  fs.writeFileSync(path.join(consumer, 'index.js'), [
    "import { analyzeImage } from '@gerrithoskins/screenshot-ai-core';",
    "globalThis.__coreSmoke = analyzeImage({ base64: 'eA==', mimeType: 'image/png' }, {",
    "provider: 'openai', apiKey: 'sk-test', model: 'fixture', maxRetries: 0,",
    "fetch: async () => ({ ok: true, status: 200, headers: { get: () => null },",
    "json: async () => ({ choices: [{ message: { content: JSON.stringify({ answer: 'metro-compatible', confidence: 1 }) } }], usage: {} }) })",
    '});',
  ].join('\n'));
  const requireConsumer = createRequire(path.join(consumer, 'package.json'));
  const { getDefaultConfig } = requireConsumer('@react-native/metro-config');
  const Metro = requireConsumer('metro');
  const config = getDefaultConfig(consumer);
  config.maxWorkers = 2;
  config.resolver.useWatchman = false;
  // runBuild accepts an already-loaded config; include projectRoot explicitly
  // as loadConfig normally does before Metro creates its file map.
  config.watchFolders = [consumer];
  config.cacheStores = [new (requireConsumer('metro-cache').FileStore)({ root: path.join(consumer, '.metro-cache') })];
  config.fileMapCacheDirectory = path.join(consumer, '.metro-file-map');
  for (const platform of ['android', 'ios']) {
    const output = path.join(consumer, platform + '.bundle.js');
    await Metro.runBuild(config, { entry: 'index.js', platform, out: output, dev: false, minify: false });
    const sandbox = { console, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, performance };
    sandbox.global = sandbox;
    vm.createContext(sandbox);
    new vm.Script(fs.readFileSync(output, 'utf8'), { filename: output }).runInContext(sandbox);
    const result = await sandbox.__coreSmoke;
    if (!result?.success || result.data.answer !== 'metro-compatible') throw new Error(platform + ' bundled analysis failed');
    console.log('Passed: ' + platform + ' Metro bundle and mocked analysis without Node globals.');
  }
  console.log('React Native compatibility checks passed; no emulator/device or live provider was used.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
