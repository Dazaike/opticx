import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(root, 'native', 'opticx-fx', 'build', 'Release', 'opticx-fx-harness.exe');

if (process.versions.electron) {
  console.log('electron host: C++ harness is the native FX smoke test');
}

if (!fs.existsSync(harness)) {
  console.error(`missing ${harness}`);
  process.exit(1);
}

const result = spawnSync(harness, [], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
