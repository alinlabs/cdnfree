export interface ScheduledSlotLease {
  aborted: boolean;
  release: () => void;
}

interface QueuedTask {
  id: string;
  priority: number;
  enqueuedAt: number;
  onAbort?: () => void;
  resolve: (lease: ScheduledSlotLease) => void;
}

export const DEFAULT_MAX_PRELOAD_SLOTS = 2;

export class VideoLoadScheduler {
  private readonly maxConcurrent: number;
  private readonly activeSlots = new Map<string, () => void>();
  private readonly queue: QueuedTask[] = [];
  private activePlayerId: string | null = null;
  private fullViewActive = false;
  private seq = 0;

  constructor(maxConcurrent = DEFAULT_MAX_PRELOAD_SLOTS) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  setActivePlayer(id: string | null): void {
    this.activePlayerId = id;
    if (id !== null) {
      this.abortBackgroundPreloads(id);
    } else {
      this.pump();
    }
  }

  setFullViewActive(active: boolean): void {
    this.fullViewActive = active;
    if (active) {
      this.abortBackgroundPreloads(null);
    } else {
      this.pump();
    }
  }

  isBackgroundPaused(): boolean {
    return this.fullViewActive || this.activePlayerId !== null;
  }

  getActiveCount(): number {
    return this.activeSlots.size;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  requestPreloadSlot(
    id: string,
    options: { priority?: number; onAbort?: () => void } = {},
  ): Promise<ScheduledSlotLease> {
    if (this.fullViewActive || (this.activePlayerId !== null && this.activePlayerId !== id)) {
      return Promise.resolve({ aborted: true, release: () => {} });
    }

    // Deduplicate same card re-requesting
    this.cancel(id);

    return new Promise<ScheduledSlotLease>((resolve) => {
      this.seq += 1;
      this.queue.push({
        id,
        priority: options.priority ?? 0,
        enqueuedAt: this.seq,
        onAbort: options.onAbort,
        resolve,
      });
      this.pump();
    });
  }

  cancel(id: string): void {
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.queue[i]?.id === id) {
        const [removed] = this.queue.splice(i, 1);
        removed?.onAbort?.();
        removed?.resolve({ aborted: true, release: () => {} });
      }
    }
    const activeAbort = this.activeSlots.get(id);
    if (activeAbort) {
      this.activeSlots.delete(id);
      activeAbort();
      this.pump();
    }
  }

  private abortBackgroundPreloads(exceptId: string | null): void {
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      const task = this.queue[i];
      if (!task || task.id === exceptId) continue;
      this.queue.splice(i, 1);
      task.onAbort?.();
      task.resolve({ aborted: true, release: () => {} });
    }

    for (const [slotId, abortFn] of Array.from(this.activeSlots.entries())) {
      if (slotId === exceptId) continue;
      this.activeSlots.delete(slotId);
      abortFn();
    }
  }

  private pump(): void {
    if (this.fullViewActive) return;

    while (this.activeSlots.size < this.maxConcurrent && this.queue.length > 0) {
      // Highest priority first, then LIFO (newest visible card first)
      this.queue.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.enqueuedAt - a.enqueuedAt;
      });

      const next = this.queue.shift();
      if (!next) break;

      if (this.activePlayerId !== null && this.activePlayerId !== next.id) {
        next.onAbort?.();
        next.resolve({ aborted: true, release: () => {} });
        continue;
      }

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.activeSlots.delete(next.id);
        this.pump();
      };

      this.activeSlots.set(next.id, () => {
        if (released) return;
        released = true;
        next.onAbort?.();
      });

      next.resolve({ aborted: false, release });
    }
  }
}

export const videoLoadScheduler = new VideoLoadScheduler(DEFAULT_MAX_PRELOAD_SLOTS);
