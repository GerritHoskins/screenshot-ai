const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

// A successful cross-build can still contain the host's optional sharp binary.
// Reject that package before creating an installer that cannot launch.
module.exports = async function verifyPackagedApp(context) {
  const { appOutDir, electronPlatformName: platform, arch, packager } = context;
  const architecture = { 1: 'x64', 3: 'arm64' }[arch];
  if (!['win32', 'darwin'].includes(platform)) return;
  if (!architecture) throw new Error('Desktop packaging supports x64 and arm64 targets.');

  const resources = platform === 'darwin'
    ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(appOutDir, 'resources');
  const modules = join(resources, 'app.asar.unpacked', 'node_modules');
  const keytar = join(modules, 'keytar', 'build', 'Release', 'keytar.node');
  const sharpDirectory = join(modules, '@img', `sharp-${platform}-${architecture}`, 'lib');
  let nativeFiles;
  try {
    nativeFiles = [keytar, ...readdirSync(sharpDirectory)
      .filter(name => name.endsWith('.node')).map(name => join(sharpDirectory, name))];
    if (nativeFiles.length < 2 || nativeFiles.some(file => !statSync(file).isFile() || statSync(file).size === 0)) {
      throw new Error('Native module missing or empty');
    }
  } catch {
    throw new Error(`Missing native modules for ${platform}-${architecture}. Install locked dependencies on the target architecture before packaging.`);
  }

  if (platform === 'win32') {
    const expectedMachine = architecture === 'x64' ? 0x8664 : 0xaa64;
    for (const file of nativeFiles) {
      const binary = readFileSync(file);
      const peOffset = binary.readUInt32LE(0x3c);
      if (binary.toString('ascii', 0, 2) !== 'MZ'
        || binary.readUInt32LE(peOffset) !== 0x00004550
        || binary.readUInt16LE(peOffset + 4) !== expectedMachine) {
        throw new Error(`Packaged native module has the wrong Windows architecture: ${file}`);
      }
    }
  }
  console.log(`Verified packaged native modules for ${platform}-${architecture}.`);
};
