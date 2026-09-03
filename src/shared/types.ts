export interface CameraInfo {
  activeCamera: number;
  cameras: Array<{ id: number; name: string }>;
  zoomMin: number;
  zoomMax: number;
  currentZoom: number;
  evMin: number;
  evMax: number;
  currentEv: number;
  torch: boolean;
  afMode: number;
}

export interface BatteryInfo {
  level: number;
  state: number;
  charging: boolean;
}

export interface StreamConfig {
  host: string;
  port: number;
  width: number;
  height: number;
  format: 'avc' | 'hevc' | 'jpg';
  fps?: number;
}

export interface FilterSettings {
  sharpen: number;     // 0.0 - 2.0 (default: 0.0)
  brightness: number;  // -1.0 - 1.0 (default: 0.0)
  contrast: number;    // 0.0 - 2.0 (default: 1.0)
  saturation: number;  // 0.0 - 2.0 (default: 1.0)
  hue: number;         // -180 - 180 (degrees, default: 0)
  gamma: number;       // 0.2 - 3.0 (default: 1.0)
  opacity: number;     // 0.0 - 1.0 (default: 1.0)
}

export interface TransformSettings {
  rotation: number;    // 0, 90, 180, 270 degrees
  flipH: boolean;
  flipV: boolean;
  scaleX: number;
  scaleY: number;
  offsetX: number;     // normalized [-1, 1]
  offsetY: number;     // normalized [-1, 1]
  fitMode: 'contain' | 'cover' | 'stretch' | 'original';
}

export interface OverlayFilters {
  brightness: number;  // -1.0 - 1.0 (default: 0.0)
  contrast: number;    // 0.0 - 2.0 (default: 1.0)
  saturation: number;  // 0.0 - 2.0 (default: 1.0)
  hue: number;         // -180 - 180 (degrees, default: 0)
  blur?: number;       // 0 - 20 (px, default: 0)
}

export const DEFAULT_OVERLAY_FILTERS: OverlayFilters = {
  brightness: 0.0,
  contrast: 1.0,
  saturation: 1.0,
  hue: 0,
  blur: 0
};

export interface OverlayItem {
  id: string;
  name: string;
  imageDataUrl: string;
  x: number;          // normalized [0, 1]
  y: number;          // normalized [0, 1]
  width: number;      // normalized [0, 1]
  height: number;     // normalized [0, 1]
  rotation?: number;  // 0, 90, 180, 270 (degrees)
  flipH?: boolean;
  flipV?: boolean;
  opacity: number;    // 0.0 - 1.0
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
  visible: boolean;
  filters: OverlayFilters;
}
