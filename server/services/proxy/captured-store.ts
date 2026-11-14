import crypto from 'node:crypto';
import type { ResourceRecord } from '../../types/server.ts';
import { getActiveFilterEngine } from '../filter-source-manager.ts';
import { classifyResourceKind } from '../../../src/utils/classify-resource.ts';

const MAX_SESSIONS = 100;
const MAX_ASSETS_PER_SESSION = 500;
const SESSION_TTL_MS = 30 * 60 * 1000;

interface CapturedSession {
  resources: Map<string, ResourceRecord>;
  expiresAt: number;
}

export function inferKindFromMimeOrUrl(
  url: string,
  mimeType?: string,
): ResourceRecord['kind'] {
  const mime = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (
    mime.startsWith('video/') ||
    mime === 'application/vnd.apple.mpegurl' ||
    mime === 'application/x-mpegurl' ||
    mime === 'application/dash+xml'
  ) {
    return 'video';
  }
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'text/css') return 'stylesheet';
  if (
    mime.includes('javascript') ||
    mime.includes('ecmascript')
  ) {
    return 'script';
  }
  if (mime.startsWith('font/') || mime.includes('font')) return 'font';
  if (mime === 'text/html' || mime === 'application/xhtml+xml' || mime === 'application/pdf') {
    return 'document';
  }
  return classifyResourceKind(url);
}

function buildResourceId(url: string): string {
  return `cap-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}`;
}

export class CapturedAssetStore {
  private readonly sessions = new Map<string, CapturedSession>();

  record(
    sessionId: string,
    params: {
      url: string;
      pageUrl?: string;
      mimeType?: string;
      declaredBytes?: number;
    },
  ): ResourceRecord | null {
    const now = Date.now();
    this.prune(now);

    let parsed: URL;
    try {
      parsed = new URL(params.url);
    } catch {
      return null;
    }

    let session = this.sessions.get(sessionId);
    if (!session) {
      if (this.sessions.size >= MAX_SESSIONS) {
        const oldestKey = this.sessions.keys().next().value;
        if (oldestKey) this.sessions.delete(oldestKey);
      }
      session = {
        resources: new Map<string, ResourceRecord>(),
        expiresAt: now + SESSION_TTL_MS,
      };
      this.sessions.set(sessionId, session);
    } else {
      session.expiresAt = now + SESSION_TTL_MS;
    }

    if (
      !session.resources.has(params.url) &&
      session.resources.size >= MAX_ASSETS_PER_SESSION
    ) {
      return null;
    }

    const kind = inferKindFromMimeOrUrl(params.url, params.mimeType);
    const pageHost = params.pageUrl
      ? (() => {
          try {
            return new URL(params.pageUrl).hostname.toLowerCase();
          } catch {
            return parsed.hostname.toLowerCase();
          }
        })()
      : parsed.hostname.toLowerCase();

    const filterOutcome = getActiveFilterEngine().evaluateUrl(
      params.url,
      pageHost,
      { kind },
    );

    const cleanMime = params.mimeType
      ? params.mimeType.split(';')[0]?.trim().toLowerCase()
      : undefined;

    const record: ResourceRecord = {
      id: buildResourceId(params.url),
      url: params.url,
      host: parsed.hostname.toLowerCase(),
      kind,
      mimeType: cleanMime || undefined,
      declaredBytes:
        typeof params.declaredBytes === 'number' &&
        Number.isFinite(params.declaredBytes) &&
        params.declaredBytes >= 0
          ? params.declaredBytes
          : undefined,
      source: 'browser-observed',
      observation: 'fetched',
      classification: filterOutcome.classification,
      reason: filterOutcome.reason,
    };

    session.resources.set(params.url, record);
    return record;
  }

  list(sessionId: string): ResourceRecord[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return [];
    }
    return Array.from(session.resources.values());
  }

  private prune(now: number): void {
    for (const [id, entry] of this.sessions.entries()) {
      if (now > entry.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }
}

export const defaultCapturedAssetStore = new CapturedAssetStore();
