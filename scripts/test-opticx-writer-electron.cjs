const path = require('node:path');
const { app } = require('electron');

app.whenReady().then(() => {
  try {
    const addonPath = path.join(__dirname, '..', 'native', 'opticx-vcam', 'addon', 'build', 'Release', 'opticx_writer.node');
    const writer = require(addonPath);
    const started = writer.start(30);
    if (!started.ok) throw new Error(started.error);
    const frame = new Uint8Array(3840 * 2160 * 3 / 2);
    frame.fill(16);
    frame[0] = 235;
    writer.writeFrame(frame, 333333n);
    const holdMs = Number(process.env.OPTICX_TEST_HOLD_MS ?? 0);
    if (holdMs > 0) {
      console.log(`READY holding OpticX Cam for ${holdMs}ms`);
      setTimeout(() => {
        writer.stop();
        app.quit();
      }, holdMs);
      return;
    }
    writer.stop();
    console.log('PASS Electron loads, starts, writes, and stops OpticX Cam');
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
