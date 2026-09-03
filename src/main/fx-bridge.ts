import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import type { FxConfigureRequest, FxProcessResult, FxStage, PipelineSettings } from '../shared/types';
import { DEFAULT_PIPELINE } from '../shared/types';

const PIPELINE_FILE = 'pipeline.json';
const DIRTY_FILE = 'pipeline-dirty';
const FX_CMD_CONFIGURE = 2;
const FX_CMD_PROCESS = 3;
const FX_CMD_RESET = 4;
const FX_CMD_QUIT = 5;

interface NativeFx {
  open(): { ok: boolean; error?: string };
  close(): void;
  writeInput(
    rgba: Uint8Array,
    width: number,
    height: number,
    pts: bigint
  ): { ok: boolean; slot?: number; error?: string };
  readOutput(slot: number): {
    ok: boolean;
    rgba?: Uint8Array;
    width?: number;
    height?: number;
    error?: string;
  };
  issue(command: Record<string, unknown>): { ok: boolean; error?: string };
  waitAck(timeoutMs?: number): Promise<{
    ok: boolean;
    status?: number;
    errorCode?: number;
    ms?: number;
    error?: string;
  }>;
}

const nativeRequire = createRequire(__filename);

function userDataFile(name: string): string {
  return path.join(app.getPath('userData'), name);
}

export function isSafeModeRequested(): boolean {
  return process.argv.includes('--safe-mode');
}

export function consumeCrashGuard(): boolean {
  const dirtyPath = userDataFile(DIRTY_FILE);
  if (fs.existsSync(dirtyPath)) {
    try {
      fs.unlinkSync(dirtyPath);
    } catch {
      /* still treat as crashed */
    }
    return true;
  }
  return false;
}

export function markPipelineDirty(): void {
  try {
    fs.writeFileSync(userDataFile(DIRTY_FILE), String(Date.now()));
  } catch {
    /* non-fatal */
  }
}

export function markPipelineClean(): void {
  try {
    fs.unlinkSync(userDataFile(DIRTY_FILE));
  } catch {
    /* already clean */
  }
}

export function loadPipelineSettings(): PipelineSettings {
  try {
    const raw = fs.readFileSync(userDataFile(PIPELINE_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PipelineSettings>;
    return {
      artifactReduction: { ...DEFAULT_PIPELINE.artifactReduction, ...parsed.artifactReduction },
      denoise: { ...DEFAULT_PIPELINE.denoise, ...parsed.denoise },
      superRes: { ...DEFAULT_PIPELINE.superRes, ...parsed.superRes },
      fastUpscale: { ...DEFAULT_PIPELINE.fastUpscale, ...parsed.fastUpscale },
      rife: { ...DEFAULT_PIPELINE.rife, ...parsed.rife },
      fsr: { ...DEFAULT_PIPELINE.fsr, ...parsed.fsr }
    };
  } catch {
    return { ...DEFAULT_PIPELINE, artifactReduction: { ...DEFAULT_PIPELINE.artifactReduction } };
  }
}

export function savePipelineSettings(settings: PipelineSettings): void {
  fs.writeFileSync(userDataFile(PIPELINE_FILE), JSON.stringify(settings, null, 2));
}

export function resolveRifeModelPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'models/rife_v4.25_lite_v2.onnx'),
    path.resolve(__dirname, '../../models/rife_v4.25_lite_v2.onnx'),
    path.join(app.getAppPath(), 'models', 'rife_v4.25_lite_v2.onnx')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function stageId(stage: FxStage): number {
  if (stage === 'superres') return 1;
  if (stage === 'upscale') return 2;
  return 0;
}

export class FxBridge {
  private host: ChildProcess | null = null;
  private addon: NativeFx | null = null;
  private ready = false;
  private lastError: string | undefined;
  private starting: Promise<{ ok: boolean; error?: string }> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  get status(): { ready: boolean; error?: string } {
    return { ready: this.ready, error: this.lastError };
  }

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.host && this.ready && this.addon) return { ok: true };
    if (this.starting) return this.starting;
    this.starting = this.boot();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  writeInput(rgba: Uint8Array, width: number, height: number, pts: bigint) {
    if (!this.addon) return { ok: false as const, error: 'FX host is not running' };
    return this.addon.writeInput(rgba, width, height, pts);
  }

  readOutput(slot: number) {
    if (!this.addon) return { ok: false as const, error: 'FX host is not running' };
    return this.addon.readOutput(slot);
  }

  /** One command at a time: the SHM control block is a single slot. */
  private run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async configure(config: FxConfigureRequest): Promise<{ ok: boolean; error?: string; errorCode?: number }> {
    const started = await this.start();
    if (!started.ok || !this.addon) return started;
    return this.run(async () => {
      if (!this.addon) return { ok: false, error: 'FX host is not running' };
      const issued = this.addon.issue({ cmd: FX_CMD_CONFIGURE, ...config });
      if (!issued.ok) return issued;
      const ack = await this.addon.waitAck(60000);
      this.ready = ack.ok;
      this.lastError = ack.error;
      return { ok: ack.ok, error: ack.error, errorCode: ack.errorCode };
    });
  }

  async resetTemporal(): Promise<{ ok: boolean; error?: string }> {
    if (!this.addon || !this.ready) return { ok: true };
    return this.run(async () => {
      if (!this.addon) return { ok: true };
      const issued = this.addon.issue({ cmd: FX_CMD_RESET });
      if (!issued.ok) return issued;
      const ack = await this.addon.waitAck(5000);
      return { ok: ack.ok, error: ack.error };
    });
  }

  async process(stage: FxStage, slot: number): Promise<FxProcessResult> {
    if (!this.addon || !this.ready) {
      return { ok: false, width: 0, height: 0, ms: 0, stageMs: {}, error: 'FX host is not running' };
    }
    return this.run(async () => {
      if (!this.addon) {
        return { ok: false, width: 0, height: 0, ms: 0, stageMs: {}, error: 'FX host is not running' };
      }
      const issued = this.addon.issue({ cmd: FX_CMD_PROCESS, stage: stageId(stage), slot });
      if (!issued.ok) {
        return { ok: false, width: 0, height: 0, ms: 0, stageMs: {}, error: issued.error };
      }
      const ack = await this.addon.waitAck(20000);
      return {
        ok: ack.ok,
        width: 0,
        height: 0,
        ms: ack.ms ?? 0,
        stageMs: {},
        error: ack.error,
        errorCode: ack.errorCode
      };
    });
  }

  async stop(): Promise<void> {
    if (this.addon) {
      try {
        this.addon.issue({ cmd: FX_CMD_QUIT });
        await this.addon.waitAck(2000);
      } catch {
        /* host may already be dead */
      }
      this.addon.close();
      this.addon = null;
    }
    if (this.host) {
      this.host.kill();
      this.host = null;
    }
    this.ready = false;
  }

  private async boot(): Promise<{ ok: boolean; error?: string }> {
    await this.stop();

    const hostCandidates = [
      path.join(process.resourcesPath || '', 'native/opticx-fx/opticx-fx-host.exe'),
      path.resolve(__dirname, '../../native/opticx-fx/build/Release/opticx-fx-host.exe'),
      path.resolve(__dirname, '../native/opticx-fx/build/Release/opticx-fx-host.exe')
    ];
    const hostPath = hostCandidates.find((p) => p && fs.existsSync(p)) || hostCandidates[1];

    const addonCandidates = [
      path.join(process.resourcesPath || '', 'native/opticx-fx/opticx_fx.node'),
      path.resolve(__dirname, '../../native/opticx-fx/build/Release/opticx_fx.node'),
      path.resolve(__dirname, '../native/opticx-fx/build/Release/opticx_fx.node')
    ];
    const addonPath = addonCandidates.find((p) => p && fs.existsSync(p)) || addonCandidates[1];
    if (!fs.existsSync(hostPath)) {
      this.lastError = `FX host missing at ${hostPath}`;
      return { ok: false, error: this.lastError };
    }
    if (!fs.existsSync(addonPath)) {
      this.lastError = `FX addon missing at ${addonPath}`;
      return { ok: false, error: this.lastError };
    }

    try {
      this.addon = nativeRequire(addonPath) as NativeFx;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return { ok: false, error: this.lastError };
    }

    const opened = this.addon.open();
    if (!opened.ok) {
      this.lastError = opened.error ?? 'FX shared memory open failed';
      this.addon = null;
      return { ok: false, error: this.lastError };
    }

    this.host = spawn(hostPath, [], {
      windowsHide: true,
      stdio: 'ignore',
      detached: false
    });
    this.host.on('exit', () => {
      this.ready = false;
      this.lastError = 'FX host exited';
      this.host = null;
    });

    const ack = await this.addon.waitAck(15000);
    this.ready = ack.ok;
    this.lastError = ack.error;
    return { ok: ack.ok, error: ack.error };
  }
}
