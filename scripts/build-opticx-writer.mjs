import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
