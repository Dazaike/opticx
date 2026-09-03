import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const addonPath = path.join(root, 'native', 'opticx-vcam', 'addon', 'build', 'Release', 'opticx_writer.node');
const writer = createRequire(import.meta.url)(addonPath);
const frameBytes = 3840 * 2160 * 3 / 2;

let checks = 0;
function check(label, condition) {
  checks++;
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
}

const started = writer.start(30);
check('starts a producer', started.ok === true);
check('reports active', writer.active() === true);
writer.writeFrame(new Uint8Array(frameBytes).fill(128), 333333n);
check('accepts one 4K NV12 frame', true);
let rejected = false;
try {
  writer.writeFrame(new Uint8Array(frameBytes - 1), 666666n);
} catch {
  rejected = true;
}
check('rejects undersized frames', rejected);
writer.stop();
check('stops the producer', writer.active() === false);
console.log(`${checks}/${checks} checks passed`);
