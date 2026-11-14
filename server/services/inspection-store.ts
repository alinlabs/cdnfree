import type { ServerInspectionResult } from '../types/server.ts';

const MAX_STORED_INSPECTIONS = 100;
const INSPECTION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface StoredEntry {
  result: ServerInspectionResult;
  expiresAt: number;
}

export class InspectionStore {
  private readonly store = new Map<string, StoredEntry>();

  set(result: ServerInspectionResult): void {
    const now = Date.now();
    this.prune(now);

    if (this.store.size >= MAX_STORED_INSPECTIONS) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(result.id, {
      result,
      expiresAt: now + INSPECTION_TTL_MS,
    });
  }

  get(id: string): ServerInspectionResult | null {
    const entry = this.store.get(id);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(id);
      return null;
    }

    return entry.result;
  }

  addCapturedResource(
    inspectionId: string,
    resource: ServerInspectionResult['resources'][number],
  ): void {
    const existing = this.get(inspectionId);
    if (!existing) return;
    if (existing.resources.length >= 500) return;

    const alreadyPresent = existing.resources.some(
      (item) => item.id === resource.id || item.url === resource.url,
    );
    if (alreadyPresent) return;

    existing.resources.push(resource);
    existing.summary.resourceCount = existing.resources.length;
  }

  private prune(now: number): void {
    for (const [id, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(id);
      }
    }
  }
}

export const defaultInspectionStore = new InspectionStore();
