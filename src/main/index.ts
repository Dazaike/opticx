import { app, BrowserWindow, ipcMain, clipboard, nativeImage, Tray, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { DroidCamSocketClient } from './droidcam-socket';
import { DroidCamHttpClient } from './droidcam-http';
import { VideoStreamServer } from './video-bridge';
import { VirtualCamera, VCAM_FRAME_BYTES } from './virtual-cam';
import type { VcamFps } from './virtual-cam';
import { StreamConfig } from '../shared/types';


process.on('uncaughtException', (err) => {
  console.error('[Main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Main] unhandledRejection:', reason);
});
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayBaseIcon: Electron.NativeImage | null = null;
let batteryPoll: NodeJS.Timeout | null = null;
let quitting = false;
const socketClient = new DroidCamSocketClient();
const httpClient = new DroidCamHttpClient();
const videoBridge = new VideoStreamServer(8999);
const virtualCam = new VirtualCamera();

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
/** hrtime origin so virtual camera timestamps start at 0 and stay monotonic. */
let vcamEpochNs = 0n;

function resolveIconPath(): string | undefined {
  const candidateIconPaths = [
    path.join(__dirname, '../opticx-icon.png'),
    path.join(__dirname, '../../public/opticx-icon.png'),
    path.join(app.getAppPath(), 'public/opticx-icon.png'),
    path.join(process.cwd(), 'public/opticx-icon.png')
  ];
  return candidateIconPaths.find((p) => fs.existsSync(p));
}

/** Paint a bright green broadcast pip on the top-right of the tray icon. */
function iconWithBroadcastDot(base: Electron.NativeImage): Electron.NativeImage {
  const size = 32;
  const resized = base.resize({ width: size, height: size });
  const buf = Buffer.from(resized.toBitmap());
  const cx = 26;
  const cy = 6;
  const radius = 5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = (y * size + x) * 4;
      const ring = dx * dx + dy * dy > (radius - 1) * (radius - 1);
      buf[i] = ring ? 20 : 48;
      buf[i + 1] = ring ? 220 : 255;
      buf[i + 2] = ring ? 80 : 64;
      buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function updateTrayBroadcast(active: boolean): void {
  if (!tray || !trayBaseIcon) return;
  tray.setImage(active ? iconWithBroadcastDot(trayBaseIcon) : trayBaseIcon);
  tray.setToolTip(active ? 'Optic X Studio — Broadcasting' : 'Optic X Studio');
}

function stopBatteryPoll(): void {
  if (batteryPoll) {
    clearInterval(batteryPoll);
    batteryPoll = null;
  }
}

function startBatteryPoll(): void {
  stopBatteryPoll();
  const tick = async () => {
    try {
      const info = await httpClient.getBatteryInfo();
      mainWindow?.webContents.send('battery:update', info);
    } catch {
      // Phone HTTP can drop a sample; the next tick retries.
    }
  };
  void tick();
  batteryPoll = setInterval(() => void tick(), 2000);
}

function createWindow() {
  const iconPath = resolveIconPath();
  const windowIcon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Optic X Studio',
    icon: windowIcon,
    backgroundColor: '#070b12',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../index.html'));
  }

  mainWindow.webContents.setBackgroundThrottling(false);
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] render-process-gone:', details);
  });
  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    console.log('[Renderer]', message);
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.opticx.studio');
  }

  const iconPath = resolveIconPath();
  if (iconPath) {
    trayBaseIcon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
    tray = new Tray(trayBaseIcon);
    tray.setToolTip('Optic X Studio');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Show Optic X Studio',
          click: () => {
            if (!mainWindow) createWindow();
            mainWindow?.show();
            mainWindow?.focus();
          }
        },
        {
          label: 'Quit Optic X Studio',
          click: () => {
            quitting = true;
            app.quit();
          }
        }
      ])
    );
    tray.on('click', () => {
      if (!mainWindow) createWindow();
      if (mainWindow?.isMinimized()) mainWindow.restore();
      mainWindow?.show();
      mainWindow?.focus();
    });
  }

  videoBridge.start();

  socketClient.on('packet', (packet) => {
    videoBridge.broadcastPacket(packet);
  });

  socketClient.on('connected', () => {
    mainWindow?.webContents.send('stream:status', { connected: true });
  });

  socketClient.on('disconnected', (err) => {
    // Drop the cached SPS/PPS so a reconnect at another resolution does not
    // replay a stale config to the renderer's decoder.
    videoBridge.clearConfig();
    mainWindow?.webContents.send('stream:status', { connected: false, error: err });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Close-to-tray: the window is hidden, not destroyed.
});

app.on('before-quit', () => {
  quitting = true;
  stopBatteryPoll();
  tray?.destroy();
  tray = null;
  socketClient.disconnect();
  videoBridge.stop();
  virtualCam.stop();
});

ipcMain.handle('stream:connect', async (_event, config: StreamConfig) => {
  httpClient.setEndpoint(config.host, config.port);
  socketClient.disconnect();
  videoBridge.clearConfig();
  socketClient.connect(config);
  startBatteryPoll();
  return { success: true };
});

ipcMain.handle('stream:disconnect', async () => {
  stopBatteryPoll();
  socketClient.disconnect();
  return { success: true };
});
// IPC handlers for Hardware Controls
ipcMain.handle('camera:getPhoneName', async () => {
  return await httpClient.getPhoneName();
});

ipcMain.handle('camera:getBatteryInfo', async () => {
  return await httpClient.getBatteryInfo();
});

ipcMain.handle('camera:getCameraList', async () => {
  return await httpClient.getCameraList();
});

ipcMain.handle('camera:getInfo', async () => {
  return await httpClient.getCameraInfo();
});

ipcMain.handle('camera:toggleTorch', async () => {
  return await httpClient.toggleTorch();
});

ipcMain.handle('camera:autofocus', async () => {
  return await httpClient.triggerAutofocus();
});

ipcMain.handle('camera:setAfMode', async (_event, mode: number) => {
  return await httpClient.setAutofocusMode(mode);
});

ipcMain.handle('camera:setZoom', async (_event, zoom: number) => {
  return await httpClient.setZoom(zoom);
});

ipcMain.handle('camera:setEv', async (_event, ev: number) => {
  return await httpClient.setExposureValue(ev);
});

ipcMain.handle('camera:setIso', async (_event, iso: number) => {
  return await httpClient.setIso(iso);
});

ipcMain.handle('camera:setShutterSpeed', async (_event, ss: number) => {
  return await httpClient.setShutterSpeed(ss);
});

ipcMain.handle('camera:setManualFocus', async (_event, mf: number) => {
  return await httpClient.setManualFocus(mf);
});

ipcMain.handle('camera:setActiveCamera', async (_event, camId: number) => {
  return await httpClient.setActiveCamera(camId);
});

// IPC Screenshot capture saving to clipboard and disk
ipcMain.handle('screenshot:save', async (_event, dataUrl: string) => {
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  const imgBuffer = Buffer.from(base64Data, 'base64');
  const image = nativeImage.createFromBuffer(imgBuffer);

  // Write to clipboard
  clipboard.writeImage(image);

  // Write to disk in Downloads folder
  const downloadsDir = app.getPath('downloads');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(downloadsDir, `opticx_${timestamp}.png`);
  fs.writeFileSync(filePath, imgBuffer);
  return { success: true, path: filePath };
});

// IPC handlers for the OpticX Cam virtual camera
ipcMain.handle('vcam:start', (_event, options: { fps: VcamFps }) => {
  const result = virtualCam.start(options.fps);
  if (result.ok) {
    vcamEpochNs = process.hrtime.bigint();
    updateTrayBroadcast(true);
    console.log(`[Main] OpticX Cam started at ${options.fps} fps`);
  } else {
    console.warn('[Main] OpticX Cam failed to start:', result.error);
  }
  return result;
});

ipcMain.handle('vcam:stop', () => {
  virtualCam.stop();
  updateTrayBroadcast(false);
  console.log('[Main] OpticX Cam stopped');
  mainWindow?.webContents.send('vcam:status', { active: false, frames: virtualCam.frameCount });
  return { ok: true };
});
ipcMain.on('vcam:frame', (_event, nv12: Uint8Array) => {
  if (!virtualCam.active) return;
  if (nv12.length !== VCAM_FRAME_BYTES) {
    console.warn(`[Main] Dropping vcam frame: ${nv12.length} bytes, expected ${VCAM_FRAME_BYTES}`);
    return;
  }

  // 100ns units since the camera was started.
  virtualCam.writeFrame(nv12, (process.hrtime.bigint() - vcamEpochNs) / 100n);

  const frames = virtualCam.frameCount;
  if (frames % 30 === 0) {
    mainWindow?.webContents.send('vcam:status', { active: true, frames });
  }
});

