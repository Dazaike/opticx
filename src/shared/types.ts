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
  sharpen: number;     // 0.0 - 2.0 (default: 0.46)
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

export type MaxineMode = 'con' | 'agg';
export type SuperResScale = 1.33 | 1.5 | 2 | 3 | 4;
export type PipelineStageId =
  | 'artifactReduction'
  | 'denoise'
  | 'superRes'
  | 'fastUpscale'
  | 'rife'
  | 'fsr';
export type PipelineRisk = 'green' | 'amber' | 'red';

export interface PipelineSettings {
  artifactReduction: { enabled: boolean; mode: MaxineMode };
  denoise: { enabled: boolean; strength: 0 | 1 };
  superRes: { enabled: boolean; scale: SuperResScale; mode: MaxineMode };
  fastUpscale: { enabled: boolean; scale: SuperResScale; strength: number };
  rife: { enabled: boolean; sensitivity: number };
  fsr: { enabled: boolean };
}

export const DEFAULT_PIPELINE: PipelineSettings = {
  artifactReduction: { enabled: false, mode: 'con' },
  denoise: { enabled: false, strength: 0 },
  superRes: { enabled: false, scale: 2, mode: 'con' },
  fastUpscale: { enabled: false, scale: 2, strength: 0.4 },
  rife: { enabled: false, sensitivity: 0.35 },
  fsr: { enabled: true }
};

export interface PipelineHud {
  stageMs: {
    artifactReduction: number;
    denoise: number;
    rife: number;
    superRes: number;
    upscale: number;
    fsr: number;
    nv12: number;
  };
  totalGpuMs: number;
  sourceFps: number;
  outputFps: number;
  droppedFrames: number;
  e2eLatencyMs: number;
  errors: Partial<Record<PipelineStageId, string>>;
  warnings: Partial<Record<PipelineStageId, string>>;
  rifeModelReady: boolean;
  fxReady: boolean;
}

export const EMPTY_PIPELINE_HUD: PipelineHud = {
  stageMs: {
    artifactReduction: 0,
    denoise: 0,
    rife: 0,
    superRes: 0,
    upscale: 0,
    fsr: 0,
    nv12: 0
  },
  totalGpuMs: 0,
  sourceFps: 0,
  outputFps: 0,
  droppedFrames: 0,
  e2eLatencyMs: 0,
  errors: {},
  warnings: {},
  rifeModelReady: false,
  fxReady: false
};

export type FxStage = 'ar-denoise' | 'superres' | 'upscale';

export interface FxConfigureRequest {
  artifactReduction: { enabled: boolean; mode: MaxineMode };
  denoise: { enabled: boolean; strength: 0 | 1 };
  superRes: { enabled: boolean; scale: SuperResScale; mode: MaxineMode };
  fastUpscale: { enabled: boolean; scale: SuperResScale; strength: number };
}

export interface FxProcessRequest {
  stage: FxStage;
  width: number;
  height: number;
}

export interface FxProcessResult {
  ok: boolean;
  width: number;
  height: number;
  ms: number;
  stageMs: Partial<Record<'artifactReduction' | 'denoise' | 'superRes' | 'upscale', number>>;
  error?: string;
  errorCode?: number;
}

export interface FxStatus {
  ready: boolean;
  error?: string;
}
