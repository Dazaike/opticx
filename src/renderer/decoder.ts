export class H264Decoder {
  private decoder: VideoDecoder | null = null;
  private onFrameCallback: (frame: VideoFrame) => void;
  private isConfigured: boolean = false;
  private spsNalu: Uint8Array | null = null;
  private ppsNalu: Uint8Array | null = null;

  constructor(onFrame: (frame: VideoFrame) => void) {
    this.onFrameCallback = onFrame;
    this.initDecoder();
  }

  private initDecoder(): void {
    if (typeof VideoDecoder === 'undefined') {
      console.error('WebCodecs VideoDecoder is not supported in this environment');
      return;
    }

    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        this.onFrameCallback(frame);
      },
      error: (e: DOMException) => {
        console.error('WebCodecs VideoDecoder error:', e.name, e.message);
        // A decoder error closes the decoder permanently; rebuild it so the
        // next config packet can reconfigure and the stream can recover.
        this.decoder = null;
        this.isConfigured = false;
        this.spsNalu = null;
        this.ppsNalu = null;
        this.initDecoder();
      }
    });
  }

  feedPacket(isConfig: boolean, pts: bigint, payload: Uint8Array): void {
    if (!this.decoder) return;

    if (isConfig) {
      this.handleConfigPacket(payload);
      return;
    }

    if (!this.isConfigured) {
      this.configureDefault();
    }

    try {
      const isKeyFrame = this.detectKeyFrame(payload);
      let chunkData = payload;

      // In WebCodecs with Annex B stream, keyframes must have SPS and PPS in-band
      if (isKeyFrame && this.spsNalu && this.ppsNalu) {
        const combined = new Uint8Array(this.spsNalu.length + this.ppsNalu.length + payload.length);
        combined.set(this.spsNalu, 0);
        combined.set(this.ppsNalu, this.spsNalu.length);
        combined.set(payload, this.spsNalu.length + this.ppsNalu.length);
        chunkData = combined;
      }

      // Real-time latency guard: if decoder has a backlog, drop delta frames
      // so the decode pipeline never accumulates latency.
      if (this.decoder.state === 'configured') {
        if (this.decoder.decodeQueueSize > 1 && !isKeyFrame) {
          return;
        }
        if (this.decoder.decodeQueueSize > 2 && isKeyFrame) {
          this.decoder.reset();
          this.configureDefault();
        }
        const chunk = new EncodedVideoChunk({
          type: isKeyFrame ? 'key' : 'delta',
          timestamp: Number(pts),
          data: chunkData
        });
        this.decoder.decode(chunk);
      }
    } catch (err) {
      console.error('Decode chunk error:', err);
    }
  }

  private detectKeyFrame(payload: Uint8Array): boolean {
    for (let i = 0; i < payload.length - 4; i++) {
      if (
        payload[i] === 0 &&
        payload[i + 1] === 0 &&
        (payload[i + 2] === 1 || (payload[i + 2] === 0 && payload[i + 3] === 1))
      ) {
        const nalIndex = payload[i + 2] === 1 ? i + 3 : i + 4;
        const nalType = payload[nalIndex] & 0x1f;
        if (nalType === 5) {
          return true;
        }
      }
    }
    return false;
  }

  private handleConfigPacket(payload: Uint8Array): void {
    // Parse SPS/PPS NALUs from Annex B payload
    // Extract profile_idc, constraint_set_flags, and level_idc from SPS
    let offset = 0;
    while (offset < payload.length - 3) {
      if (
        payload[offset] === 0 &&
        payload[offset + 1] === 0 &&
        payload[offset + 2] === 1
      ) {
        const nalType = payload[offset + 3] & 0x1f;
        const nextStart = this.findNextStartCode(payload, offset + 3);
        const nalu = payload.subarray(offset, nextStart);
        if (nalType === 7) {
          this.spsNalu = nalu;
        } else if (nalType === 8) {
          this.ppsNalu = nalu;
        }
        offset = nextStart;
      } else if (
        payload[offset] === 0 &&
        payload[offset + 1] === 0 &&
        payload[offset + 2] === 0 &&
        payload[offset + 3] === 1
      ) {
        const nalType = payload[offset + 4] & 0x1f;
        const nextStart = this.findNextStartCode(payload, offset + 4);
        const nalu = payload.subarray(offset, nextStart);
        if (nalType === 7) {
          this.spsNalu = nalu;
        } else if (nalType === 8) {
          this.ppsNalu = nalu;
        }
        offset = nextStart;
      } else {
        offset++;
      }
    }

    if (this.spsNalu) {
      const spsHeaderIndex = (this.spsNalu[2] === 1 ? 3 : 4);
      const profileIdc = this.spsNalu[spsHeaderIndex + 1].toString(16).padStart(2, '0');
      const constraint = this.spsNalu[spsHeaderIndex + 2].toString(16).padStart(2, '0');
      const levelIdc = this.spsNalu[spsHeaderIndex + 3].toString(16).padStart(2, '0');
      const codec = `avc1.${profileIdc}${constraint}${levelIdc}`;
      try {
        this.decoder?.configure({
          codec: codec,
          optimizeForLatency: true,
          hardwareAcceleration: 'prefer-hardware'
        });
        this.isConfigured = true;
        console.log(`[Decoder] Configured successfully with codec ${codec}`);
      } catch (err) {
        console.error('[Decoder] Configure error:', err);
        this.configureDefault();
      }
    } else {
      this.configureDefault();
    }
  }

  private findNextStartCode(data: Uint8Array, start: number): number {
    for (let i = start; i < data.length - 3; i++) {
      if (
        data[i] === 0 &&
        data[i + 1] === 0 &&
        (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))
      ) {
        return i;
      }
    }
    return data.length;
  }

  private configureDefault(): void {
    // 4K H.264 High Profile 5.1
    this.decoder?.configure({
      codec: 'avc1.640033',
      optimizeForLatency: true,
      hardwareAcceleration: 'prefer-hardware'
    });
    this.isConfigured = true;
  }

  reset(): void {
    this.isConfigured = false;
    this.spsNalu = null;
    this.ppsNalu = null;

    if (!this.decoder || this.decoder.state === 'closed') {
      // A closed decoder cannot be reused; create a fresh one
      this.decoder = null;
      this.initDecoder();
      return;
    }

    try {
      this.decoder.reset();
    } catch {
      this.decoder = null;
      this.initDecoder();
    }
  }

  close(): void {
    if (this.decoder && this.decoder.state !== 'closed') {
      try {
        this.decoder.close();
      } catch {}
      this.decoder = null;
    }
  }
}
