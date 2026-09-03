import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = path.join(root, 'native', 'opticx-fx');
const addonDir = path.join(nativeDir, 'addon');
const buildDir = path.join(nativeDir, 'build');
const releaseDir = path.join(buildDir, 'Release');
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const nodeGyp = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');

// The N-API addon is built with node-gyp so it picks up the Windows
// delay-load hook that redirects node.exe imports to the Electron host.
// A CMake-linked addon crashes Electron at require().
execFileSync(process.execPath, [
  nodeGyp,
  'rebuild',
  `--target=${electronVersion}`,
  '--arch=x64',
  '--dist-url=https://electronjs.org/headers'
], { cwd: addonDir, stdio: 'inherit' });

function findCmake() {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const install = execFileSync(vswhere, [
    '-latest',
    '-products',
    '*',
    '-property',
    'installationPath'
  ], { encoding: 'utf8' }).trim();
  const cmake = path.join(install, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe');
  if (!fs.existsSync(cmake)) throw new Error(`cmake.exe not found under ${install}`);
  return cmake;
}

// CMake builds only the standalone Maxine processes: the FX host that owns
// CUDA/TensorRT, and the offline harness.
const cmake = findCmake();
execFileSync(cmake, ['-S', nativeDir, '-B', buildDir, '-G', 'Visual Studio 17 2022', '-A', 'x64'], {
  cwd: root,
  stdio: 'inherit'
});
execFileSync(cmake, ['--build', buildDir, '--config', 'Release', '--parallel'], {
  cwd: root,
  stdio: 'inherit'
});

fs.mkdirSync(releaseDir, { recursive: true });
const gypAddon = path.join(addonDir, 'build', 'Release', 'opticx_fx.node');
if (!fs.existsSync(gypAddon)) throw new Error(`opticx_fx.node was not produced at ${gypAddon}`);
fs.copyFileSync(gypAddon, path.join(releaseDir, 'opticx_fx.node'));

for (const exe of ['opticx-fx-host.exe', 'opticx-fx-harness.exe']) {
  const built = path.join(releaseDir, exe);
  if (!fs.existsSync(built)) throw new Error(`${exe} was not produced at ${built}`);
}

console.log(`built ${path.join(releaseDir, 'opticx_fx.node')}`);
console.log(`built ${path.join(releaseDir, 'opticx-fx-host.exe')}`);
