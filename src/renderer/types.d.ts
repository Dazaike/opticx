import { ElectronAPI } from '../preload';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

declare module '*.png' {
  const src: string;
  export default src;
}
