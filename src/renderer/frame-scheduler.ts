export interface TimestampedFrame {
  timestamp: number;
  close(): void;
}

export class FrameScheduler<T extends TimestampedFrame> {
  private readonly capacity: number;
  private readonly queue: T[] = [];
  private droppedCount = 0;

  constructor(capacity = 3) {
    this.capacity = capacity;
  }

  push(frame: T): void {
    let i = 0;
    while (i < this.queue.length && this.queue[i].timestamp < frame.timestamp) {
      i++;
    }

    if (i < this.queue.length && this.queue[i].timestamp === frame.timestamp) {
      this.queue[i].close();
      this.droppedCount++;
      this.queue[i] = frame;
      return;
    }

    this.queue.splice(i, 0, frame);
    while (this.queue.length > this.capacity) {
      const oldest = this.queue.shift();
      if (!oldest) break;
      oldest.close();
      this.droppedCount++;
    }
  }

  acquireForPresent(nowUs: number, frameIntervalUs: number): T | null {
    const half = frameIntervalUs / 2;
    const dueLimit = nowUs + half;
    const lateLimit = nowUs - half;

    while (this.queue.length > 0) {
      let dueIdx = -1;
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.queue[i].timestamp <= dueLimit) {
          dueIdx = i;
          break;
        }
      }
      if (dueIdx < 0) return null;

      for (let i = 0; i < dueIdx; i++) {
        this.queue[i].close();
        this.droppedCount++;
      }
      if (dueIdx > 0) this.queue.splice(0, dueIdx);

      const frame = this.queue[0];
      if (frame.timestamp < lateLimit && this.queue.length > 1) {
        this.queue.shift();
        frame.close();
        this.droppedCount++;
        continue;
      }

      this.queue.shift();
      return frame;
    }

    return null;
  }

  peek(): T | null {
    return this.queue[0] ?? null;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  get size(): number {
    return this.queue.length;
  }

  clear(): void {
    for (const frame of this.queue) {
      frame.close();
    }
    this.queue.length = 0;
  }
}
