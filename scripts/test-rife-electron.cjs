// Runs the real RIFE model in an Electron renderer with WebGPU and checks the
// [1,7,H,W] input contract plus midpoint motion.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

app.commandLine.appendSwitch('enable-unsafe-webgpu');

const fileUrl = (p) => 'file:///' + path.resolve(__dirname, p).replace(/\\/g, '/');

const html = `<html><body><script>
const { ipcRenderer } = require('electron');
const log = (m) => ipcRenderer.send('rife', String(m));
(async () => {
  try {
    const ort = await import(${JSON.stringify(fileUrl('../node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs'))});
    ort.env.wasm.wasmPaths = ${JSON.stringify(fileUrl('../node_modules/onnxruntime-web/dist/') + '/')};
    ort.env.wasm.numThreads = 1;

    const buf = await (await fetch(${JSON.stringify(fileUrl('../models/rife_v4.25_lite_v2.onnx'))})).arrayBuffer();
    const session = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] });
    log('inputs=' + JSON.stringify(session.inputNames));
    log('outputs=' + JSON.stringify(session.outputNames));

    const W = 64, H = 64, plane = W * H;
    const data = new Float32Array(7 * plane);
    const put = (base, x0) => {
      for (let y = 24; y < 40; y++) {
        for (let x = x0; x < x0 + 16 && x < W; x++) {
          for (let c = 0; c < 3; c++) data[base + c * plane + y * W + x] = 1;
        }
      }
    };
    put(0, 4);
    put(3 * plane, 44);
    data.fill(0.5, 6 * plane, 7 * plane);

    const t = new ort.Tensor('float32', data, [1, 7, H, W]);
    const t0 = performance.now();
    const out = await session.run({ [session.inputNames[0]]: t });
    const ms = performance.now() - t0;
    const o = out[session.outputNames[0]];
    log('outDims=' + JSON.stringify(o.dims) + ' ms=' + ms.toFixed(1));

    const d = o.data;
    let sx = 0, n = 0;
    for (let y = 24; y < 40; y++) {
      for (let x = 0; x < W; x++) {
        if (d[y * W + x] > 0.5) { sx += x; n++; }
      }
    }
    log(n ? 'centroidX=' + (sx / n).toFixed(1) + ' bright=' + n : 'centroidX=none bright=0');
    log('__DONE__');
  } catch (e) {
    log('ERROR ' + (e && e.message ? e.message : e));
    log('__DONE__');
  }
})();
</script></body></html>`;

const page = path.join(os.tmpdir(), `opticx-rife-test-${process.pid}.html`);
fs.writeFileSync(page, html);

const lines = [];
ipcMain.on('rife', (_e, m) => {
  lines.push(m);
  if (m !== '__DONE__') console.log('RIFE', m);
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webgl: true }
  });
  await win.loadFile(page);

  const deadline = Date.now() + 90000;
  while (!lines.includes('__DONE__') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }

  fs.rmSync(page, { force: true });
  const failed = !lines.includes('__DONE__') || lines.some((l) => l.startsWith('ERROR'));
  console.log(failed ? 'FAIL' : 'PASS');
  app.exit(failed ? 1 : 0);
});
