import net from 'net';
import { EventEmitter } from 'events';
import { StreamConfig } from '../shared/types';

export interface VideoPacket {
  pts: bigint;
  isConfig: boolean;
  data: Buffer;
}

export class DroidCamSocketClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private isConnecting: boolean = false;
  private isConnected: boolean = false;

  connect(config: StreamConfig): void {
    if (this.socket) {
      this.disconnect();
    }

    this.isConnecting = true;
    const socket = new net.Socket();
    this.socket = socket;

    socket.connect(config.port, config.host, () => {
      this.isConnecting = false;
      this.isConnected = true;
      this.emit('connected');

      // Handshake format:
      // GET /v5/video/%s/%dx%d/port/%d/os/%s/obs/%s/client/%s/nonce/%d/
      const format = config.format || 'avc';
      const width = config.width || 1920;
      const height = config.height || 1080;
      const request = `GET /v5/video/${format}/${width}x${height}/port/0/os/win10.0.22631/obs//client/721/nonce/5912/`;

      socket.write(request);
    });

    socket.on('data', (chunk: Buffer) => {
      if (this.socket !== socket) return;
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });

    socket.on('error', (err: Error) => {
      if (this.socket !== socket) return;
      this.emit('error', err);
      this.cleanup();
    });

    // A superseded socket must not clear state that now belongs to a newer one.
    socket.on('close', (hadError: boolean) => {
      if (this.socket !== socket) return;
      this.isConnected = false;
      this.emit('disconnected', hadError);
      this.cleanup();
    });
  }

  private processBuffer(): void {
    // Each packet header is 12 bytes:
    // [pts: 8 bytes big-endian uint64] [len: 4 bytes big-endian uint32]
    while (this.buffer.length >= 12) {
      const pts = this.buffer.readBigUInt64BE(0);
      const len = this.buffer.readUInt32BE(8);

      if (this.buffer.length < 12 + len) {
        // Wait for complete frame payload
        break;
      }

      const payload = this.buffer.subarray(12, 12 + len);
      this.buffer = this.buffer.subarray(12 + len);

      // pts === 0xFFFFFFFFFFFFFFFFn signifies SPS/PPS / AVCC config
      const isConfig = pts === 0xFFFFFFFFFFFFFFFFn;
      const packet: VideoPacket = {
        pts,
        isConfig,
        data: Buffer.from(payload)
      };

      this.emit('packet', packet);
    }
  }

  disconnect(): void {
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
      this.cleanup();
    }
  }

  private cleanup(): void {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.isConnecting = false;
    this.isConnected = false;
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
