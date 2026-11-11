// Fail before packaging when a required resource or production entry point is missing.
const { statSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const { main, version, build } = require('../package.json');

let files;
if (process.argv[2] === '--artifacts') {
  const [platform, arch] = process.argv.slice(3);
  if (!['win', 'mac'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error('Usage: npm run verify:packaging -- --artifacts <win|mac> <x64|arm64>');
  }
  const prefix = `${build.productName}-${version}-${platform}-${arch}`;
  files = (platform === 'win' ? [`${prefix}-setup.exe`] : [`${prefix}.dmg`, `${prefix}.zip`])
    .map(file => `${build.directories.output}/${file}`);
} else {
  if (process.argv.length > 2) throw new Error('Unknown packaging verification arguments');
  files = [
    build.mac.entitlements,
    build.mac.entitlementsInherit,
    build.afterPack,
    main,
    ...['index', 'overlay', 'chooser'].map(name => `dist/preload/${name}.js`),
    ...['index', 'overlay', 'settings', 'chooser'].map(name => `dist/renderer/${name}.html`),
  ];
}

const missing = [...new Set(files)].filter(file => {
  if (typeof file !== 'string' || !file) return true;
  try {
    const stat = statSync(resolve(root, file));
    return !stat.isFile() || stat.size === 0;
  } catch {
    return true;
  }
});
if (missing.length) {
  console.error(`Missing or empty packaging files:\n${missing.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${new Set(files).size} packaging files.`);
}
