/// <reference types="vite/client" />
import type { InferenceSession, Tensor } from 'onnxruntime-web/webgpu';
import type * as OrtType from 'onnxruntime-web/webgpu';
import packWgsl from './wgsl/rife-pack.wgsl?raw';

type OrtModule = typeof OrtType;
let ortPromise: Promise<OrtModule> | null = null;
function getOrt(): Promise<OrtModule> {
  if (!ortPromise) ortPromise = import('onnxruntime-web/webgpu');
  return ortPromise;
}
export type RifeFrame = VideoFrame | ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
const MAD_W = 64;
const MAD_H = 36;
const ALIGN = 32;

const BUF_STORAGE = 0x80;
const BUF_UNIFORM = 0x40;
const BUF_COPY_SRC = 0x04;
const BUF_COPY_DST = 0x08;
const BUF_MAP_READ = 0x01;
const TEX_COPY_DST = 0x02;
const TEX_BINDING = 0x04;
const TEX_RENDER = 0x10;
const MAP_READ = 0x0001;

interface GpuBuffer {
  size: number;
  destroy(): void;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
}

interface GpuTexture {
  createView(): unknown;
  destroy(): void;
}

interface GpuComputePipeline {
  getBindGroupLayout(index: number): unknown;
}

type GpuBindGroup = object;

interface GpuQueue {
  copyExternalImageToTexture(src: unknown, dst: unknown, size: { width: number; height: number }): void;
  writeBuffer(buffer: GpuBuffer, offset: number, data: BufferSource): void;
  submit(commands: unknown[]): void;
}

interface GpuComputePass {
  setPipeline(pipeline: GpuComputePipeline): void;
  setBindGroup(index: number, group: GpuBindGroup): void;
  dispatchWorkgroups(x: number, y: number, z?: number): void;
  end(): void;
}

interface GpuCommandEncoder {
  beginComputePass(): GpuComputePass;
  copyBufferToBuffer(src: GpuBuffer, srcOffset: number, dst: GpuBuffer, dstOffset: number, size: number): void;
  finish(): unknown;
}

interface GpuDevice {
  createBuffer(desc: Record<string, unknown>): GpuBuffer;
  createTexture(desc: Record<string, unknown>): GpuTexture;
  createShaderModule(desc: { code: string }): unknown;
  createComputePipeline(desc: Record<string, unknown>): GpuComputePipeline;
  createBindGroup(desc: Record<string, unknown>): GpuBindGroup;
  createCommandEncoder(): GpuCommandEncoder;
  queue: GpuQueue;
  destroy(): void;
}

interface GpuAdapter {
  requestDevice(): Promise<GpuDevice>;
}

type NavigatorGpu = {
  gpu?: { requestAdapter(opts?: { powerPreference?: string }): Promise<GpuAdapter | null> };
};

function pad32(n: number): number {
  return (n + (ALIGN - 1)) & ~(ALIGN - 1);
}

function clamp255(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return v + 0.5 | 0;
}

function frameSize(frame: RifeFrame): { w: number; h: number } {
  if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) {
    return { w: frame.displayWidth, h: frame.displayHeight };
  }
  const img = frame as ImageBitmap | HTMLCanvasElement;
  return { w: img.width, h: img.height };
}

function nchwToRgba(rgb: ArrayLike<number>, padW: number, padH: number, srcW: number, srcH: number): Uint8Array {
  const out = new Uint8Array(srcW * srcH * 4);
  const plane = padW * padH;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const si = y * padW + x;
      const di = (y * srcW + x) * 4;
      out[di] = clamp255(rgb[si] * 255);
      out[di + 1] = clamp255(rgb[plane + si] * 255);
      out[di + 2] = clamp255(rgb[plane * 2 + si] * 255);
      out[di + 3] = 255;
    }
  }
  return out;
}

function packNchw(pixels: Uint8ClampedArray, srcW: number, srcH: number, padW: number, padH: number): Float32Array {
  const out = new Float32Array(3 * padW * padH);
  const plane = padW * padH;
  for (let y = 0; y < padH; y++) {
    const sy = y < srcH ? y : srcH - 1;
    for (let x = 0; x < padW; x++) {
      const sx = x < srcW ? x : srcW - 1;
      const i = (sy * srcW + sx) * 4;
      const o = y * padW + x;
      out[o] = pixels[i] / 255;
      out[plane + o] = pixels[i + 1] / 255;
      out[plane * 2 + o] = pixels[i + 2] / 255;
    }
  }
  return out;
}

/**
 * Midpoint PTS and delay from prev present until the interpolated frame is due.
 * nextDelayMs is half the (next-prev) interval in milliseconds.
 */
export function rifeSchedule(prevTsUs: number, nextTsUs: number): { midTsUs: number; nextDelayMs: number } {
  return {
    midTsUs: (prevTsUs + nextTsUs) / 2,
    nextDelayMs: (nextTsUs - prevTsUs) / 2000
  };
}

/**
 * RIFE 2x interpolator (v4.25 lite) on WebGPU via onnxruntime-web.
 *
 * Frames are replicate-padded to a multiple of 32 (1080 -> 1088) before
 * inference and sliced back to the source size. interpolate() returns null
 * when a 64x36 RGB MAD scene-cut guard exceeds `sensitivity`.
 */
export class RifeInterpolator {
  private session: InferenceSession | null = null;
  private device: GpuDevice | null = null;
  private packPipeline: GpuComputePipeline | null = null;
  private unpackPipeline: GpuComputePipeline | null = null;
  private ort: OrtModule | null = null;
  private tex0: GpuTexture | null = null;
  private tex1: GpuTexture | null = null;
  private buf0: GpuBuffer | null = null;
  private buf1: GpuBuffer | null = null;
  private bufOut: GpuBuffer | null = null;
  private rgbaBuf: GpuBuffer | null = null;
  private staging: GpuBuffer | null = null;
  private uniform: GpuBuffer | null = null;
  private packGroup: GpuBindGroup | null = null;
  private unpackGroup: GpuBindGroup | null = null;
  private gpuTensor = false;
  private srcW = 0;
  private srcH = 0;
  private padW = 0;
  private padH = 0;
  private _ready = false;
  private _lastInferenceMs = 0;
  private _sensitivity = 0.35;
  private destroyed = false;
  private chain: Promise<unknown> = Promise.resolve();
  private madCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private packCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

  static async isWebGpuAvailable(): Promise<boolean> {
    const gpu = (navigator as unknown as NavigatorGpu).gpu;
    if (!gpu) return false;
    try {
      return !!(await gpu.requestAdapter({ powerPreference: 'high-performance' }));
    } catch {
      return false;
    }
  }

  get ready(): boolean {
    return this._ready;
  }

  get lastInferenceMs(): number {
    return this._lastInferenceMs;
  }

  /** MAD on 64x36 mip. Above threshold => skip warp. */
  set sensitivity(v: number) {
    this._sensitivity = v;
  }

  async init(modelData: ArrayBuffer): Promise<void> {
    if (this.destroyed) throw new Error('RIFE destroyed');
    const gpu = (navigator as unknown as NavigatorGpu).gpu;
    if (!gpu) throw new Error('WebGPU unavailable');

    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU unavailable');

    const ort = await getOrt();
    this.ort = ort;
    try {
      ort.env.wasm.wasmPaths = new URL('../../node_modules/onnxruntime-web/dist/', import.meta.url).href;
    } catch {
      ort.env.wasm.wasmPaths = WASM_CDN;
    }
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.webgpu.powerPreference = 'high-performance';
    ort.env.webgpu.adapter = adapter;
    const sessionOptions = {
      executionProviders: ['webgpu'] as const,
      preferredOutputLocation: 'gpu-buffer' as const
    };

    let session: InferenceSession;
    try {
      session = await ort.InferenceSession.create(modelData, sessionOptions);
    } catch (first) {
      ort.env.wasm.wasmPaths = WASM_CDN;
      try {
        session = await ort.InferenceSession.create(modelData, sessionOptions);
      } catch {
        throw first instanceof Error ? first : new Error('WebGPU unavailable');
      }
    }

    const device = (ort.env.webgpu.device as GpuDevice | undefined) ?? await adapter.requestDevice();
    this.session = session;
    this.device = device;
    this.gpuTensor = typeof ort.Tensor.fromGpuBuffer === 'function';

    try {
      const module = device.createShaderModule({ code: packWgsl });
      this.packPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'pack' }
      });
      this.unpackPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'unpack' }
      });
    } catch {
      this.packPipeline = null;
      this.unpackPipeline = null;
    }

    this._ready = true;
  }

  /**
   * Infer midpoint between prev and next.
   * Returns RGBA8 Uint8Array of unpadded HxW, or null if scene-cut guard fired
   * (caller should duplicate prev).
   * Pads H/W up to multiple of 32 (1080 -> 1088, 8px bottom replicate), slices back.
   */
  interpolate(
    prev: RifeFrame,
    next: RifeFrame,
    timestep: number = 0.5
  ): Promise<Uint8Array | null> {
    const run = this.chain.then(() => this.interpolateInner(prev, next, timestep));
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  destroy(): void {
    this.destroyed = true;
    this._ready = false;
    this.releaseGpuBuffers();
    try { this.session?.release(); } catch { /* ignore */ }
    this.session = null;
    this.device = null;
    this.packPipeline = null;
    this.unpackPipeline = null;
  }

  private async interpolateInner(
    prev: RifeFrame,
    next: RifeFrame,
    timestep: number
  ): Promise<Uint8Array | null> {
    if (this.destroyed || !this._ready || !this.session) {
      throw new Error('RIFE not initialized');
    }

    const { w, h } = frameSize(prev);
    if (w <= 0 || h <= 0) return null;
    if (this.sceneCut(prev, next, w, h)) return null;

    const padW = pad32(w);
    const padH = pad32(h);
    const t0 = performance.now();

    let rgba: Uint8Array;
    const packed = await this.tryGpuPack(prev, next, w, h, padW, padH);
    if (packed) {
      rgba = await this.runModel(packed.img0, packed.img1, timestep, w, h, padW, padH, packed.gpu);
    } else {
      const { img0, img1 } = this.cpuPack(prev, next, w, h, padW, padH);
      rgba = await this.runModel(img0, img1, timestep, w, h, padW, padH, false);
    }

    this._lastInferenceMs = performance.now() - t0;
    return rgba;
  }

  private sceneCut(prev: RifeFrame, next: RifeFrame, srcW: number, srcH: number): boolean {
    const canvas = this.ensureCanvas('mad', MAD_W, MAD_H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return false;
    ctx.drawImage(prev as CanvasImageSource, 0, 0, srcW, srcH, 0, 0, MAD_W, MAD_H);
    const a = ctx.getImageData(0, 0, MAD_W, MAD_H).data;
    ctx.drawImage(next as CanvasImageSource, 0, 0, srcW, srcH, 0, 0, MAD_W, MAD_H);
    const b = ctx.getImageData(0, 0, MAD_W, MAD_H).data;
    let acc = 0;
    const n = MAD_W * MAD_H;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      acc += Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
    }
    return acc / (n * 3 * 255) > this._sensitivity;
  }

  private ensureCanvas(kind: 'mad' | 'pack', w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
    const existing = kind === 'mad' ? this.madCanvas : this.packCanvas;
    if (existing && existing.width === w && existing.height === h) return existing;
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(w, h);
    } else {
      const el = document.createElement('canvas');
      el.width = w;
      el.height = h;
      canvas = el;
    }
    if (kind === 'mad') this.madCanvas = canvas;
    else this.packCanvas = canvas;
    return canvas;
  }

  private ensureGpu(srcW: number, srcH: number, padW: number, padH: number): boolean {
    const device = this.device;
    if (!device || !this.packPipeline) return false;
    if (this.srcW === srcW && this.srcH === srcH && this.padW === padW && this.padH === padH && this.buf0) {
      return true;
    }
    this.releaseGpuBuffers();

    const nchwBytes = (3 * padW * padH * 4 + 15) & ~15;
    const rgbaBytes = (srcW * srcH * 4 + 15) & ~15;
    const texUsage = TEX_BINDING | TEX_COPY_DST | TEX_RENDER;
    const storageUsage = BUF_STORAGE | BUF_COPY_SRC | BUF_COPY_DST;

    this.tex0 = device.createTexture({
      size: { width: srcW, height: srcH },
      format: 'rgba8unorm',
      usage: texUsage
    });
    this.tex1 = device.createTexture({
      size: { width: srcW, height: srcH },
      format: 'rgba8unorm',
      usage: texUsage
    });
    this.buf0 = device.createBuffer({ size: nchwBytes, usage: storageUsage });
    this.buf1 = device.createBuffer({ size: nchwBytes, usage: storageUsage });
    this.bufOut = device.createBuffer({ size: nchwBytes, usage: storageUsage });
    this.rgbaBuf = device.createBuffer({ size: rgbaBytes, usage: storageUsage });
    this.staging = device.createBuffer({
      size: Math.max(nchwBytes, rgbaBytes),
      usage: BUF_MAP_READ | BUF_COPY_DST
    });
    this.uniform = device.createBuffer({
      size: 16,
      usage: BUF_UNIFORM | BUF_COPY_DST
    });

    this.packGroup = device.createBindGroup({
      layout: this.packPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.tex0.createView() },
        { binding: 1, resource: this.tex1.createView() },
        { binding: 2, resource: { buffer: this.buf0 } },
        { binding: 3, resource: { buffer: this.buf1 } },
        { binding: 4, resource: { buffer: this.uniform } }
      ]
    });
    if (this.unpackPipeline) {
      this.unpackGroup = device.createBindGroup({
        layout: this.unpackPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.bufOut } },
          { binding: 1, resource: { buffer: this.rgbaBuf } },
          { binding: 2, resource: { buffer: this.uniform } }
        ]
      });
    }

    this.srcW = srcW;
    this.srcH = srcH;
    this.padW = padW;
    this.padH = padH;
    return true;
  }

  private uploadTexture(tex: GpuTexture, frame: RifeFrame, w: number, h: number): boolean {
    const device = this.device;
    if (!device) return false;
    const size = frameSize(frame);
    try {
      if (size.w === w && size.h === h) {
        device.queue.copyExternalImageToTexture(
          { source: frame },
          { texture: tex },
          { width: w, height: h }
        );
        return true;
      }
    } catch {
      /* fall through to canvas blit */
    }
    try {
      const canvas = this.ensureCanvas('pack', w, h);
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) return false;
      ctx.drawImage(frame as CanvasImageSource, 0, 0, w, h);
      device.queue.copyExternalImageToTexture(
        { source: canvas },
        { texture: tex },
        { width: w, height: h }
      );
      return true;
    } catch {
      return false;
    }
  }

  private async tryGpuPack(
    prev: RifeFrame,
    next: RifeFrame,
    w: number,
    h: number,
    padW: number,
    padH: number
  ): Promise<{ img0: Tensor; img1: Tensor; gpu: boolean } | null> {
    const device = this.device;
    if (!device || !this.packPipeline) return null;
    if (!this.ensureGpu(w, h, padW, padH) || !this.tex0 || !this.tex1 || !this.buf0 || !this.buf1 || !this.uniform) {
      return null;
    }
    if (!this.uploadTexture(this.tex0, prev, w, h) || !this.uploadTexture(this.tex1, next, w, h)) {
      return null;
    }

    device.queue.writeBuffer(this.uniform, 0, new Uint32Array([w, h, padW, padH]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.packPipeline);
    pass.setBindGroup(0, this.packGroup!);
    pass.dispatchWorkgroups(Math.ceil(padW / 8), Math.ceil(padH / 8));
    pass.end();
    device.queue.submit([encoder.finish()]);

    const dims = [1, 3, padH, padW];
    if (this.gpuTensor) {
      try {
        return {
          img0: this.ort!.Tensor.fromGpuBuffer(this.buf0 as never, { dataType: 'float32', dims }),
          img1: this.ort!.Tensor.fromGpuBuffer(this.buf1 as never, { dataType: 'float32', dims }),
          gpu: true
        };
      } catch {
        /* map pack output into CPU tensors */
      }
    }
    const floats0 = await this.mapFloats(this.buf0, 3 * padW * padH);
    const floats1 = await this.mapFloats(this.buf1, 3 * padW * padH);
    return {
      img0: new this.ort!.Tensor('float32', floats0, dims),
      img1: new this.ort!.Tensor('float32', floats1, dims),
      gpu: false
    };
  }

  private cpuPack(
    prev: RifeFrame,
    next: RifeFrame,
    w: number,
    h: number,
    padW: number,
    padH: number
  ): { img0: Tensor; img1: Tensor } {
    const canvas = this.ensureCanvas('pack', w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('RIFE canvas unavailable');
    ctx.drawImage(prev as CanvasImageSource, 0, 0, w, h);
    const img0 = new this.ort!.Tensor('float32', packNchw(ctx.getImageData(0, 0, w, h).data, w, h, padW, padH), [1, 3, padH, padW]);
    ctx.drawImage(next as CanvasImageSource, 0, 0, w, h);
    const img1 = new this.ort!.Tensor('float32', packNchw(ctx.getImageData(0, 0, w, h).data, w, h, padW, padH), [1, 3, padH, padW]);
    return { img0, img1 };
  }

  private async runModel(
    img0: Tensor,
    img1: Tensor,
    timestep: number,
    w: number,
    h: number,
    padW: number,
    padH: number,
    gpuInputs: boolean
  ): Promise<Uint8Array> {
    const session = this.session!;
    const t = new this.ort!.Tensor('float32', new Float32Array([timestep]), [1, 1, 1, 1]);
    const names = session.inputNames;
    const feeds: Record<string, Tensor> = {};
    if (names.includes('img0') && names.includes('img1')) {
      feeds.img0 = img0;
      feeds.img1 = img1;
      const tName = names.find((n) => n !== 'img0' && n !== 'img1') ?? 'timestep';
      feeds[tName] = t;
    } else {
      feeds[names[0]] = img0;
      if (names[1]) feeds[names[1]] = img1;
      if (names[2]) feeds[names[2]] = t;
    }

    const fetches = this.prepareFetches(session, padW, padH, gpuInputs);
    const results = fetches
      ? await session.run(feeds, fetches)
      : await session.run(feeds);
    const outName = session.outputNames[0];
    const out = results[outName];
    try {
      return await this.readOutput(out, w, h, padW, padH);
    } finally {
      if (!fetches) {
        try { out.dispose(); } catch { /* ignore */ }
      }
    }
  }

  private prepareFetches(
    session: InferenceSession,
    padW: number,
    padH: number,
    gpuInputs: boolean
  ): Record<string, Tensor> | undefined {
    if (!gpuInputs || !this.gpuTensor || !this.bufOut) return undefined;
    try {
      const tensor = this.ort!.Tensor.fromGpuBuffer(this.bufOut as never, {
        dataType: 'float32',
        dims: [1, 3, padH, padW]
      });
      return { [session.outputNames[0]]: tensor };
    } catch {
      return undefined;
    }
  }

  private async readOutput(
    tensor: Tensor,
    w: number,
    h: number,
    padW: number,
    padH: number
  ): Promise<Uint8Array> {
    const tensorObj = tensor as unknown as { location?: string; gpuBuffer?: GpuBuffer };
    const loc = tensorObj.location;
    const gpuBuffer = tensorObj.gpuBuffer;
    if (loc === 'gpu-buffer' && gpuBuffer && this.unpackPipeline && this.device && this.rgbaBuf && this.uniform) {
      if (gpuBuffer !== this.bufOut) {
        this.bindUnpack(gpuBuffer);
      }
      return this.gpuUnpack(w, h, padW, padH);
    }
    const data = await this.tensorFloats(tensor);
    return nchwToRgba(data, padW, padH, w, h);
  }

  private bindUnpack(src: GpuBuffer): void {
    if (!this.device || !this.unpackPipeline || !this.rgbaBuf || !this.uniform) return;
    this.unpackGroup = this.device.createBindGroup({
      layout: this.unpackPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src } },
        { binding: 1, resource: { buffer: this.rgbaBuf } },
        { binding: 2, resource: { buffer: this.uniform } }
      ]
    });
  }

  private async gpuUnpack(w: number, h: number, padW: number, padH: number): Promise<Uint8Array> {
    const device = this.device!;
    device.queue.writeBuffer(this.uniform!, 0, new Uint32Array([padW, padH, w, h]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.unpackPipeline!);
    pass.setBindGroup(0, this.unpackGroup!);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    pass.end();
    const bytes = w * h * 4;
    encoder.copyBufferToBuffer(this.rgbaBuf!, 0, this.staging!, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await this.staging!.mapAsync(MAP_READ);
    const copy = new Uint8Array(this.staging!.getMappedRange(0, bytes).slice(0));
    this.staging!.unmap();
    return copy;
  }

  private async mapFloats(buffer: GpuBuffer, floats: number): Promise<Float32Array> {
    const device = this.device!;
    const bytes = floats * 4;
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, this.staging!, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await this.staging!.mapAsync(MAP_READ);
    const copy = new Float32Array(this.staging!.getMappedRange(0, bytes).slice(0));
    this.staging!.unmap();
    return copy;
  }

  private async tensorFloats(tensor: Tensor): Promise<Float32Array> {
    const anyTensor = tensor as Tensor & { getData?: () => Promise<unknown> };
    const raw = anyTensor.getData ? await anyTensor.getData() : tensor.data;
    if (raw instanceof Float32Array) return raw;
    if (ArrayBuffer.isView(raw)) {
      return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    }
    if (raw instanceof ArrayBuffer) {
      return new Float32Array(raw);
    }
    return new Float32Array(0);
  }

  private releaseGpuBuffers(): void {
    for (const buf of [this.buf0, this.buf1, this.bufOut, this.rgbaBuf, this.staging, this.uniform]) {
      try { buf?.destroy(); } catch { /* ignore */ }
    }
    try { this.tex0?.destroy(); } catch { /* ignore */ }
    try { this.tex1?.destroy(); } catch { /* ignore */ }
    this.buf0 = this.buf1 = this.bufOut = this.rgbaBuf = this.staging = this.uniform = null;
    this.tex0 = this.tex1 = null;
    this.packGroup = this.unpackGroup = null;
    this.srcW = this.srcH = this.padW = this.padH = 0;
  }

}
