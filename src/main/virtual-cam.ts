import { createRequire } from 'module';
import path from 'path';

/**
 * Writer half of the OpticX Cam shared-memory video queue. The DirectShow
 * filter consumes processed 3840×2160 NV12 frames from this section.
 *
 * The writer is a small N-API addon compiled against Electron. Loading Koffi
 * in Electron 32 crashes its Node-API environment before a window can open,
 * so this module deliberately has no third-party native-addon dependency.
 */

export const VCAM_SECTION_NAME = 'OpticXCamVideo4K';
export const VCAM_WIDTH = 3840;
export const VCAM_HEIGHT = 2160;
export type VcamFps = 30 | 60;
export const VCAM_INTERVALS_100NS: Record<VcamFps, bigint> = {
  30: 333333n,
  60: 166666n
};
export const VCAM_FRAME_BYTES = (VCAM_WIDTH * VCAM_HEIGHT * 3) / 2;

const HEADER_SIZE = 0x50;
const FRAME_HEADER_SIZE = 32;
const SLOT_COUNT = 3;
const ADDON_PATH = path.resolve(__dirname, '../../native/opticx-vcam/addon/build/Release/opticx_writer.node');
const nativeRequire = createRequire(import.meta.url);

export const QUEUE_STATE_INVALID = 0;
export const QUEUE_STATE_STARTING = 1;
export const QUEUE_STATE_READY = 2;
export const QUEUE_STATE_STOPPING = 3;

export interface QueueLayout {
  offsets: number[];
  totalSize: number;
}

/** Slot offsets and total shared-section size for a given NV12 payload size. */
export function computeQueueLayout(frameSize: number): QueueLayout {
  const align32 = (value: number) => (value + 31) & ~31;
  const offsets: number[] = [];
  let size = align32(HEADER_SIZE);
  for (let i = 0; i < SLOT_COUNT; i++) {
    offsets.push(size);
    size = align32(size + FRAME_HEADER_SIZE + frameSize);
  }
  return { offsets, totalSize: size };
}

export interface StartResult {
  ok: boolean;
  error?: string;
}

interface NativeWriter {
  start(fps: VcamFps): StartResult;
  writeFrame(nv12: Uint8Array, timestamp100ns: bigint): void;
  stop(): void;
  active(): boolean;
}

let writer: NativeWriter | null = null;

function nativeWriter(): NativeWriter {
  if (writer) return writer;
  try {
    writer = nativeRequire(ADDON_PATH) as NativeWriter;
    return writer;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`OpticX Cam native writer could not load: ${detail}`);
  }
}

export class VirtualCamera {
  private frames = 0;

  get active(): boolean {
    return writer?.active() ?? false;
  }

  get frameCount(): number {
    return this.frames;
  }

  start(fps: VcamFps = 30): StartResult {
    if (process.platform !== 'win32') return { ok: false, error: 'OpticX Cam requires Windows.' };
    try {
      const result = nativeWriter().start(fps);
      if (result.ok) this.frames = 0;
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  writeFrame(nv12: Uint8Array, timestamp100ns: bigint): void {
    if (nv12.length !== VCAM_FRAME_BYTES) {
      throw new RangeError(
        `OpticX Cam expects ${VCAM_FRAME_BYTES} NV12 bytes per frame, received ${nv12.length}.`
      );
    }
    nativeWriter().writeFrame(nv12, timestamp100ns);
    this.frames++;
  }

  stop(): void {
    writer?.stop();
  }
}
