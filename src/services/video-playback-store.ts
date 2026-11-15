import type { ResourceRecord } from '../types/inspection.ts';
import { isLocalAppMediaUrl, normalizeLocalAppMediaUrl } from '../utils/local-media.ts';
import type { StorageLike } from './history-service.ts';

export type VideoSourceMode = 'cache' | 'hls' | 'stream' | 'direct';

export interface VideoPlaybackSnapshot {
  key: string;
  currentTime: number;
  duration: number;
  wasPlaying: boolean;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  preferredSourceMode?: VideoSourceMode;
  directFailed?: boolean;
  updatedAt: number;
}

export type VideoPlaybackPatch = Partial<Omit<VideoPlaybackSnapshot, 'key'>>;
export type PlaybackSnapshotListener = (snapshot: VideoPlaybackSnapshot) => void;

export const PLAYBACK_STORE_STORAGE_KEY = 'cdnfree:video-playback:v1';
export const MAX_PLAYBACK_SNAPSHOTS = 200;
const STORAGE_FLUSH_INTERVAL_MS = 400;

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage ?? window.localStorage;
  } catch {
    return null;
  }
}

function getPersistentStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeCanonicalVideoUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (isLocalAppMediaUrl(trimmed)) {
    const normalized = normalizeLocalAppMediaUrl(trimmed);
    if (/into-landscape/i.test(normalized)) {
      return '/local-asset/into-landscape.mp4';
    }
    return normalized;
  }
  try {
    const parsed = new URL(
      trimmed,
      typeof window !== 'undefined' ? window.location.origin : 'https://cdnfree.local',
    );
    if (
      typeof window !== 'undefined' &&
      parsed.origin === window.location.origin &&
      isLocalAppMediaUrl(parsed.pathname)
    ) {
      const normalizedPath = normalizeLocalAppMediaUrl(parsed.pathname);
      if (/into-landscape/i.test(normalizedPath)) {
        return '/local-asset/into-landscape.mp4';
      }
      return normalizedPath;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return trimmed.split('#')[0] ?? trimmed;
  }
}

export function hashCanonicalVideoKey(canonicalUrl: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < canonicalUrl.length; i += 1) {
    const code = canonicalUrl.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `sc-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export function getCanonicalVideoKey(
  resourceOrUrl: Pick<ResourceRecord, 'url'> | string,
): string {
  const rawUrl = typeof resourceOrUrl === 'string' ? resourceOrUrl : resourceOrUrl.url;
  const canonical = normalizeCanonicalVideoUrl(rawUrl);
  return hashCanonicalVideoKey(canonical || rawUrl);
}

function sanitizeNumber(value: unknown, fallback: number, min = 0, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sanitizeSourceMode(value: unknown): VideoSourceMode | undefined {
  if (value === 'cache' || value === 'hls' || value === 'stream' || value === 'direct') {
    return value;
  }
  return undefined;
}

function sanitizeSnapshot(key: string, raw: unknown): VideoPlaybackSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  return {
    key,
    currentTime: sanitizeNumber(obj.currentTime, 0, 0),
    duration: sanitizeNumber(obj.duration, 0, 0),
    wasPlaying: Boolean(obj.wasPlaying),
    playbackRate: sanitizeNumber(obj.playbackRate, 1, 0.25, 16),
    volume: sanitizeNumber(obj.volume, 1, 0, 1),
    isMuted: typeof obj.isMuted === 'boolean' ? obj.isMuted : false,
    preferredSourceMode: sanitizeSourceMode(obj.preferredSourceMode),
    directFailed: typeof obj.directFailed === 'boolean' ? obj.directFailed : undefined,
    updatedAt: sanitizeNumber(obj.updatedAt, Date.now(), 0),
  };
}

export class VideoPlaybackStore {
  private readonly snapshots = new Map<string, VideoPlaybackSnapshot>();
  private readonly listeners = new Map<string, Set<PlaybackSnapshotListener>>();
  private readonly recentlyPurgedUntil = new Map<string, number>();
  private readonly sessionStorage: StorageLike | null;
  private readonly localStorage: StorageLike | null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedFromStorage = false;

  constructor(
    sessionStorage: StorageLike | null = getDefaultStorage(),
    localStorage: StorageLike | null = getPersistentStorage(),
  ) {
    this.sessionStorage = sessionStorage;
    this.localStorage = localStorage;
  }

  private ensureHydrated(): void {
    if (this.loadedFromStorage) return;
    this.loadedFromStorage = true;
    const sources = [this.localStorage, this.sessionStorage];
    for (const storage of sources) {
      if (!storage) continue;
      try {
        const raw = storage.getItem(PLAYBACK_STORE_STORAGE_KEY);
        if (!raw) continue;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;
        for (const entry of parsed) {
          if (!entry || typeof entry !== 'object') continue;
          const key = (entry as { key?: unknown }).key;
          if (typeof key !== 'string' || !key) continue;
          const clean = sanitizeSnapshot(key, entry);
          if (!clean) continue;
          const existing = this.snapshots.get(key);
          if (!existing || clean.updatedAt > existing.updatedAt) {
            this.snapshots.set(key, clean);
          }
        }
      } catch {
        // Ignore corrupted storage entries
      }
    }
    this.enforceLimit();
  }

  private enforceLimit(): void {
    if (this.snapshots.size <= MAX_PLAYBACK_SNAPSHOTS) return;
    const sorted = Array.from(this.snapshots.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    this.snapshots.clear();
    for (const item of sorted.slice(0, MAX_PLAYBACK_SNAPSHOTS)) {
      this.snapshots.set(item.key, item);
    }
  }

  getSnapshot(key: string): VideoPlaybackSnapshot | null {
    this.ensureHydrated();
    return this.snapshots.get(key) ?? null;
  }

  saveSnapshot(
    key: string,
    patch: VideoPlaybackPatch,
    options: { immediate?: boolean; notify?: boolean; isUnmountFlush?: boolean } = {},
  ): VideoPlaybackSnapshot {
    this.ensureHydrated();
    const purgedUntil = this.recentlyPurgedUntil.get(key) ?? 0;
    if (options.isUnmountFlush && Date.now() <= purgedUntil) {
      return (
        this.snapshots.get(key) ?? {
          key,
          currentTime: 0,
          duration: 0,
          wasPlaying: false,
          playbackRate: 1,
          volume: 1,
          isMuted: false,
          updatedAt: Date.now(),
        }
      );
    }
    this.recentlyPurgedUntil.delete(key);
    const prev = this.snapshots.get(key);
    const next: VideoPlaybackSnapshot = {
      key,
      currentTime:
        patch.currentTime !== undefined
          ? sanitizeNumber(patch.currentTime, prev?.currentTime ?? 0, 0)
          : (prev?.currentTime ?? 0),
      duration:
        patch.duration !== undefined
          ? sanitizeNumber(patch.duration, prev?.duration ?? 0, 0)
          : (prev?.duration ?? 0),
      wasPlaying: patch.wasPlaying ?? prev?.wasPlaying ?? false,
      playbackRate:
        patch.playbackRate !== undefined
          ? sanitizeNumber(patch.playbackRate, prev?.playbackRate ?? 1, 0.25, 16)
          : (prev?.playbackRate ?? 1),
      volume:
        patch.volume !== undefined
          ? sanitizeNumber(patch.volume, prev?.volume ?? 1, 0, 1)
          : (prev?.volume ?? 1),
      isMuted: patch.isMuted ?? prev?.isMuted ?? false,
      preferredSourceMode: patch.preferredSourceMode ?? prev?.preferredSourceMode,
      directFailed: patch.directFailed ?? prev?.directFailed,
      updatedAt: patch.updatedAt ?? Date.now(),
    };

    this.snapshots.set(key, next);
    this.enforceLimit();

    if (options.notify !== false) {
      const subs = this.listeners.get(key);
      if (subs) {
        for (const cb of subs) {
          cb(next);
        }
      }
    }

    if (options.immediate) {
      this.flushStorage();
    } else {
      this.scheduleFlush();
    }

    return next;
  }

  markDirectFailed(key: string): void {
    this.saveSnapshot(
      key,
      { directFailed: true, preferredSourceMode: 'stream' },
      { immediate: true },
    );
  }

  removeSnapshot(key: string, options?: { suppressUnmountMs?: number }): void {
    this.ensureHydrated();
    if (options?.suppressUnmountMs && options.suppressUnmountMs > 0) {
      this.recentlyPurgedUntil.set(key, Date.now() + options.suppressUnmountMs);
    }
    if (!this.snapshots.delete(key)) return;
    this.flushStorage();
  }

  subscribe(key: string, listener: PlaybackSnapshotListener): () => void {
    let subs = this.listeners.get(key);
    if (!subs) {
      subs = new Set();
      this.listeners.set(key, subs);
    }
    subs.add(listener);
    return () => {
      subs?.delete(listener);
      if (subs && subs.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushStorage();
    }, STORAGE_FLUSH_INTERVAL_MS);
  }

  flushStorage(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.enforceLimit();
    const isEmpty = this.snapshots.size === 0;
    const serialized = isEmpty
      ? ''
      : JSON.stringify(Array.from(this.snapshots.values()));
    for (const storage of [this.sessionStorage, this.localStorage]) {
      if (!storage) continue;
      try {
        if (isEmpty) {
          storage.removeItem(PLAYBACK_STORE_STORAGE_KEY);
        } else {
          storage.setItem(PLAYBACK_STORE_STORAGE_KEY, serialized);
        }
      } catch {
        // Ignore quota errors on playback snapshot persistence
      }
    }
  }

  clearAll(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.snapshots.clear();
    this.loadedFromStorage = true;
    for (const storage of [this.sessionStorage, this.localStorage]) {
      if (!storage) continue;
      try {
        storage.removeItem(PLAYBACK_STORE_STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
  }
}

export const videoPlaybackStore = new VideoPlaybackStore();
