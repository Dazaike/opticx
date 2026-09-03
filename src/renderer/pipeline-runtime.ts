import type { FxProcessResult, PipelineSettings, PipelineStageId } from '../shared/types';
import { RifeInterpolator } from './rife';

export async function videoFrameToRgba(
  frame: VideoFrame
): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  const rgba = new Uint8Array(width * height * 4);
  try {
    await frame.copyTo(rgba, { format: 'RGBA' });
  } catch {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not copy VideoFrame to RGBA');
    ctx.drawImage(frame, 0, 0);
    rgba.set(ctx.getImageData(0, 0, width, height).data);
  }
  return { rgba, width, height };
}

function rgbaCanvas(rgba: Uint8Array, width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas;
}

async function runFxStage(
  stage: 'ar-denoise' | 'superres' | 'upscale',
  rgba: Uint8Array,
  width: number,
  height: number,
  pts: bigint
): Promise<{ rgba: Uint8Array; width: number; height: number; result: FxProcessResult }> {
  const wrote = await window.electronAPI.fxWriteInput(rgba, width, height, pts);
  if (!wrote.ok || wrote.slot === undefined) {
    return {
      rgba,
      width,
      height,
      result: {
        ok: false,
        width,
        height,
        ms: 0,
        stageMs: {},
        error: wrote.error ?? 'FX write failed'
      }
    };
  }
  const result = await window.electronAPI.fxProcess(stage, wrote.slot);
  if (!result.ok) return { rgba, width, height, result };
  const out = await window.electronAPI.fxReadOutput(wrote.slot);
  if (!out.ok || !out.rgba || !out.width || !out.height) {
    return {
      rgba,
      width,
      height,
      result: {
        ...result,
        ok: false,
        error: out.error ?? result.error ?? 'FX read failed'
      }
    };
  }
  return { rgba: out.rgba, width: out.width, height: out.height, result };
}

export interface PipelineFrame {
  rgba: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
}

export interface PipelineOutput {
  frames: PipelineFrame[];
  stageMs: Partial<Record<'artifactReduction' | 'denoise' | 'rife' | 'superRes' | 'upscale', number>>;
  errors: Partial<Record<PipelineStageId, string>>;
  disable: PipelineStageId[];
}

export class PipelineRunner {
  readonly rife = new RifeInterpolator();
  private prev: { canvas: OffscreenCanvas; ts: number; rgba: Uint8Array; width: number; height: number } | null =
    null;

  async process(frame: VideoFrame, pipeline: PipelineSettings): Promise<PipelineOutput> {
    const errors: PipelineOutput['errors'] = {};
    const disable: PipelineStageId[] = [];
    const stageMs: PipelineOutput['stageMs'] = {};
    const pts = BigInt(Math.max(0, Math.round(frame.timestamp)));
    const srcTs = frame.timestamp;

    let { rgba, width, height } = await videoFrameToRgba(frame);
    frame.close();

    const needArDenoise = pipeline.artifactReduction.enabled || pipeline.denoise.enabled;
    if (needArDenoise) {
      const out = await runFxStage('ar-denoise', rgba, width, height, pts);
      if (out.result.ok) {
        rgba = out.rgba;
        width = out.width;
        height = out.height;
        if (out.result.stageMs.artifactReduction) {
          stageMs.artifactReduction = out.result.stageMs.artifactReduction;
        }
        if (out.result.stageMs.denoise) stageMs.denoise = out.result.stageMs.denoise;
      } else {
        const err = out.result.error ?? 'FX ar-denoise failed';
        if (pipeline.artifactReduction.enabled) errors.artifactReduction = err;
        if (pipeline.denoise.enabled) errors.denoise = err;
        if (out.result.errorCode === -16 || out.result.errorCode === -10) {
          if (pipeline.artifactReduction.enabled) disable.push('artifactReduction');
          if (pipeline.denoise.enabled) disable.push('denoise');
        }
      }
    }

    const frames: PipelineFrame[] = [];
    if (pipeline.rife.enabled && this.rife.ready && this.prev) {
      this.rife.sensitivity = pipeline.rife.sensitivity;
      const t0 = performance.now();
      try {
        const mid = await this.rife.interpolate(this.prev.canvas, rgbaCanvas(rgba, width, height), 0.5);
        stageMs.rife = this.rife.lastInferenceMs || performance.now() - t0;
        if (mid) {
          frames.push({
            rgba: mid,
            width,
            height,
            timestamp: (this.prev.ts + srcTs) / 2
          });
        }
      } catch (err) {
        errors.rife = err instanceof Error ? err.message : String(err);
      }
    }

    if (pipeline.superRes.enabled) {
      const out = await runFxStage('superres', rgba, width, height, pts);
      if (out.result.ok) {
        rgba = out.rgba;
        width = out.width;
        height = out.height;
        stageMs.superRes = out.result.stageMs.superRes ?? out.result.ms;
        if (frames.length === 1) {
          const mid = await runFxStage('superres', frames[0].rgba, frames[0].width, frames[0].height, pts);
          if (mid.result.ok) {
            frames[0] = { ...frames[0], rgba: mid.rgba, width: mid.width, height: mid.height };
          }
        }
      } else {
        errors.superRes = out.result.error ?? 'SuperRes failed';
        if (out.result.errorCode === -16 || out.result.errorCode === -10) disable.push('superRes');
      }
    } else if (pipeline.fastUpscale.enabled) {
      const out = await runFxStage('upscale', rgba, width, height, pts);
      if (out.result.ok) {
        rgba = out.rgba;
        width = out.width;
        height = out.height;
        stageMs.upscale = out.result.stageMs.upscale ?? out.result.ms;
        if (frames.length === 1) {
          const mid = await runFxStage('upscale', frames[0].rgba, frames[0].width, frames[0].height, pts);
          if (mid.result.ok) {
            frames[0] = { ...frames[0], rgba: mid.rgba, width: mid.width, height: mid.height };
          }
        }
      } else {
        errors.fastUpscale = out.result.error ?? 'Upscale failed';
        if (out.result.errorCode === -16 || out.result.errorCode === -10) disable.push('fastUpscale');
      }
    }

    frames.push({ rgba, width, height, timestamp: srcTs });
    this.prev = { canvas: rgbaCanvas(rgba, width, height), ts: srcTs, rgba, width, height };
    return { frames, stageMs, errors, disable };
  }

  reset(): void {
    this.prev = null;
    void window.electronAPI.fxResetTemporal();
  }
}
