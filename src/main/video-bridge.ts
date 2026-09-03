import WebSocket, { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { VideoPacket } from './droidcam-socket';

export class VideoStreamServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private lastConfigPacket: Buffer | null = null;
  private port: number;

  constructor(port: number = 8999) {
    super();
    this.port = port;
  }

  start(): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);

      // If we already have SPS/PPS config, send it to new client immediately
      if (this.lastConfigPacket && ws.readyState === WebSocket.OPEN) {
        this.sendPacketToClient(ws, 0xFFFFFFFFFFFFFFFFn, true, this.lastConfigPacket);
      }

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.warn('WS Client Error:', err);
        this.clients.delete(ws);
      });
    });
  }

  broadcastPacket(packet: VideoPacket): void {
    if (packet.isConfig) {
      this.lastConfigPacket = packet.data;
    }

    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        // Backpressure check: if socket buffer has more than 64KB queued,
        // drop non-config delta packets so the stream never falls behind real-time.
        if (ws.bufferedAmount > 65536 && !packet.isConfig) {
          continue;
        }
        this.sendPacketToClient(ws, packet.pts, packet.isConfig, packet.data);
      }
    }
  }

  clearConfig(): void {
    this.lastConfigPacket = null;
  }

  private sendPacketToClient(ws: WebSocket, pts: bigint, isConfig: boolean, data: Buffer): void {
    // Frame format: [flags: 1 byte (bit 0 = isConfig)] [pts: 8 bytes BE uint64] [data: N bytes]
    const header = Buffer.alloc(9);
    header.writeUInt8(isConfig ? 1 : 0, 0);
    header.writeBigUInt64BE(pts, 1);
    const combined = Buffer.concat([header, data]);
    ws.send(combined, { binary: true });
  }

  stop(): void {
    if (this.wss) {
      for (const ws of this.clients) {
        ws.terminate();
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
    }
  }
}
