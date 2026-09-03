// Drives the real FX host protocol under Electron and asserts the main
// event loop keeps running while Maxine builds its TensorRT engine.
const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const release = path.join(root, 'native', 'opticx-fx', 'build', 'Release');
const addon = require(path.join(release, 'opticx_fx.node'));
const hostExe = path.join(release, 'opticx-fx-host.exe');

const W = 1920;
const H = 1080;

function fail(msg) {
  console.error(`FAIL ${msg}`);
  app.exit(1);
}

app.whenReady().then(async () => {
  const opened = addon.open();
  if (!opened.ok) return fail(`open: ${opened.error}`);

  const host = spawn(hostExe, [], { windowsHide: true, stdio: 'ignore' });
  let hostExited = false;
  host.on('exit', (code) => {
    hostExited = true;
    console.log(`host exit code=${code}`);
  });

  // Heartbeat proves the main event loop is not blocked.
  let ticks = 0;
  const beat = setInterval(() => ticks++, 10);

  const hello = await addon.waitAck(15000);
  if (!hello.ok) return fail(`host handshake: ${hello.error}`);
  console.log('PASS host handshake');

  const t0 = Date.now();
  const issued = addon.issue({
    cmd: 2,
    artifactReduction: { enabled: true, mode: 'con' },
    denoise: { enabled: false, strength: 0 },
    superRes: { enabled: false, scale: 2, mode: 'con' },
    fastUpscale: { enabled: false, scale: 2, strength: 0.4 }
  });
  if (!issued.ok) return fail(`issue configure: ${issued.error}`);

  const cfg = await addon.waitAck(60000);
  const configureMs = Date.now() - t0;
  if (!cfg.ok) return fail(`configure AR: ${cfg.error} (code ${cfg.errorCode})`);
  console.log(`PASS configure AR in ${configureMs} ms`);

  if (ticks < 2) return fail(`main loop blocked during configure (ticks=${ticks})`);
  console.log(`PASS main loop alive during configure (ticks=${ticks})`);

  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = i % 255;
    rgba[i * 4 + 1] = (i >> 8) % 255;
    rgba[i * 4 + 2] = 128;
    rgba[i * 4 + 3] = 255;
  }

  for (let frame = 0; frame < 3; frame++) {
    const wrote = addon.writeInput(new Uint8Array(rgba), W, H, BigInt(frame * 33333));
    if (!wrote.ok) return fail(`writeInput: ${wrote.error}`);
    const p = addon.issue({ cmd: 3, stage: 0, slot: wrote.slot });
    if (!p.ok) return fail(`issue process: ${p.error}`);
    const ack = await addon.waitAck(20000);
    if (!ack.ok) return fail(`process AR: ${ack.error} (code ${ack.errorCode})`);
    const out = addon.readOutput(wrote.slot);
    if (!out.ok) return fail(`readOutput: ${out.error}`);
    if (out.width !== W || out.height !== H) {
      return fail(`AR changed size: ${out.width}x${out.height}`);
    }
    let nonBlack = 0;
    for (let i = 0; i < out.rgba.length; i += 4004) {
      if (out.rgba[i] !== 0) nonBlack++;
    }
    if (nonBlack === 0) return fail('AR output is entirely black');
    console.log(`PASS frame ${frame} AR ${out.width}x${out.height} ${ack.ms.toFixed(1)} ms`);
  }

  if (hostExited) return fail('host process died');

  clearInterval(beat);
  addon.issue({ cmd: 5 });
  await addon.waitAck(3000);
  addon.close();
  console.log('PASS');
  app.exit(0);
});
