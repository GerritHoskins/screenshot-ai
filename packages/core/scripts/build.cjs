const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const dist = path.resolve(root, 'dist');
if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') {
  throw new Error('Refusing to clean an output directory outside this package');
}

// Remove only this package's generated outputs, so old entry points cannot leak
// into a release when a source file is removed or renamed.
fs.rmSync(dist, { recursive: true, force: true });

for (const filename of ['tsconfig.esm.json', 'tsconfig.cjs.json']) {
  const configPath = path.join(root, filename);
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
  const program = ts.createProgram(config.fileNames, config.options);
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }));
    process.exit(1);
  }
  if (program.emit().emitSkipped) throw new Error('Package compilation did not emit output');
}

// Each format has its own package scope. This keeps both JavaScript and its
// declaration files interpretable under NodeNext resolution in consumers.
fs.writeFileSync(path.join(dist, 'cjs', 'package.json'), '{"type":"commonjs"}\n');
fs.writeFileSync(path.join(dist, 'esm', 'package.json'), '{"type":"module"}\n');
console.log('Built portable core: ESM, CommonJS, and declarations');
