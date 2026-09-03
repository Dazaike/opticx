import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const addonDirectory = path.join(root, 'native', 'opticx-vcam', 'addon');
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const nodeGyp = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');

execFileSync(process.execPath, [
  nodeGyp,
  'rebuild',
  `--target=${electronVersion}`,
  '--arch=x64',
  '--dist-url=https://electronjs.org/headers'
], { cwd: addonDirectory, stdio: 'inherit' });

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

const vcamDir = path.join(root, 'native', 'opticx-vcam');
const vcamBuildDir = path.join(vcamDir, 'build');
const cmake = findCmake();
execFileSync(cmake, ['-S', vcamDir, '-B', vcamBuildDir, '-G', 'Visual Studio 17 2022', '-A', 'x64'], {
  cwd: root,
  stdio: 'inherit'
});
execFileSync(cmake, ['--build', vcamBuildDir, '--config', 'Release', '--parallel'], {
  cwd: root,
  stdio: 'inherit'
});
const vcamDll = path.join(vcamBuildDir, 'Release', 'opticx-vcam.dll');
if (!fs.existsSync(vcamDll)) throw new Error(`opticx-vcam.dll missing at ${vcamDll}`);
console.log(`built ${vcamDll}`);
