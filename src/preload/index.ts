import { contextBridge, ipcRenderer } from 'electron';
import { StreamConfig, BatteryInfo } from '../shared/types';

export const electronAPI = {
  // Stream connection
  connect: (config: StreamConfig) => ipcRenderer.invoke('stream:connect', config),
  disconnect: () => ipcRenderer.invoke('stream:disconnect'),
  onStreamStatus: (callback: (status: { connected: boolean; error?: unknown }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { connected: boolean; error?: unknown }) => callback(status);
    ipcRenderer.on('stream:status', handler);
    return () => {
      ipcRenderer.removeListener('stream:status', handler);
    };
  },

  // Camera hardware controls
  getPhoneName: () => ipcRenderer.invoke('camera:getPhoneName'),
  getBatteryInfo: () => ipcRenderer.invoke('camera:getBatteryInfo'),
  onBatteryUpdate: (callback: (info: BatteryInfo) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: BatteryInfo) => callback(info);
    ipcRenderer.on('battery:update', handler);
    return () => {
      ipcRenderer.removeListener('battery:update', handler);
    };
  },
  getCameraList: () => ipcRenderer.invoke('camera:getCameraList'),
  getCameraInfo: () => ipcRenderer.invoke('camera:getInfo'),
  toggleTorch: () => ipcRenderer.invoke('camera:toggleTorch'),
  triggerAutofocus: () => ipcRenderer.invoke('camera:autofocus'),
  setAfMode: (mode: number) => ipcRenderer.invoke('camera:setAfMode', mode),
  setZoom: (zoom: number) => ipcRenderer.invoke('camera:setZoom', zoom),
  setEv: (ev: number) => ipcRenderer.invoke('camera:setEv', ev),
  setIso: (iso: number) => ipcRenderer.invoke('camera:setIso', iso),
  setShutterSpeed: (ss: number) => ipcRenderer.invoke('camera:setShutterSpeed', ss),
  setManualFocus: (mf: number) => ipcRenderer.invoke('camera:setManualFocus', mf),
  setActiveCamera: (camId: number) => ipcRenderer.invoke('camera:setActiveCamera', camId),

  // Virtual camera (OpticX Cam)
  startVirtualCam: (fps: 30 | 60): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('vcam:start', { fps }),
  stopVirtualCam: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('vcam:stop'),
  sendVcamFrame: (nv12: Uint8Array) => ipcRenderer.send('vcam:frame', nv12),
  onVcamStatus: (callback: (status: { active: boolean; frames: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { active: boolean; frames: number }) => callback(status);
    ipcRenderer.on('vcam:status', handler);
    return () => {
      ipcRenderer.removeListener('vcam:status', handler);
    };
  },

  saveScreenshot: (dataUrl: string) => ipcRenderer.invoke('screenshot:save', dataUrl)
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
