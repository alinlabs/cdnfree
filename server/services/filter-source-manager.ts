import crypto from 'node:crypto';
import { parseMimeType } from '../security/request-limits.ts';
import {
  FILTER_PARSER_VERSION,
  FilterEngine,
  createBaselineFilterDataset,
  parseFilterListText,
  type FilterSourceMetadata,
  type ParsedNetworkRule,
} from './filter-engine.ts';
import {
  MAX_FILTER_BYTES,
  OFFICIAL_REMOTE_FILTER_SOURCES,
  SourceFetchError,
  safeFetchFilterSource,
  type FetchFilterSourceFn,
  type RemoteFilterSourceSpec,
  type SourceFetchResult,
} from './filter-source-fetch.ts';

export {
  MAX_FILTER_BYTES,
  OFFICIAL_REMOTE_FILTER_SOURCES,
  SourceFetchError,
  safeFetchFilterSource,
  type FetchFilterSourceFn,
  type RemoteFilterSourceSpec,
  type SourceFetchResult,
};

export const DEFAULT_SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // Refresh cadence: daily check
export const DEFAULT_MIN_VALID_RULES = 10;

export interface SourceRefreshOutcome {
  id: string;
  outcome: 'updated' | 'not-modified' | 'failed';
  error?: string;
}

export interface RefreshSummary {
  sources: FilterSourceMetadata[];
  outcomes: SourceRefreshOutcome[];
  refreshedCount: number;
  unchangedCount: number;
  failedCount: number;
  attemptedAt: string;
}


interface StoredSourceDataset {
  spec: RemoteFilterSourceSpec;
  metadata: FilterSourceMetadata;
  allowRules: ParsedNetworkRule[];
  blockRules: ParsedNetworkRule[];
}

export interface FilterSourceManagerOptions {
  remoteSpecs?: RemoteFilterSourceSpec[];
  fetchSource?: FetchFilterSourceFn;
  minCandidateRules?: number;
  maxAgeMs?: number;
  now?: () => Date;
}

export class FilterSourceManager {
  private readonly baselineDataset = createBaselineFilterDataset();
  private readonly remoteDatasets = new Map<string, StoredSourceDataset>();
  private readonly remoteOrder: string[] = [];
  private readonly fetchSource: FetchFilterSourceFn;
  private readonly minCandidateRules: number;
  private readonly maxAgeMs: number;
  private readonly now: () => Date;

  private activeEngine: FilterEngine;
  private refreshInFlight: Promise<RefreshSummary> | null = null;
  private lastRefreshAttemptAt: string | null = null;

  constructor(options: FilterSourceManagerOptions = {}) {
    this.fetchSource = options.fetchSource ?? safeFetchFilterSource;
    this.minCandidateRules = options.minCandidateRules ?? DEFAULT_MIN_VALID_RULES;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_SOURCE_MAX_AGE_MS;
    this.now = options.now ?? (() => new Date());

    const specs = options.remoteSpecs ?? OFFICIAL_REMOTE_FILTER_SOURCES;
    for (const spec of specs) {
      this.remoteOrder.push(spec.id);
      this.remoteDatasets.set(spec.id, {
        spec,
        metadata: {
          id: spec.id,
          name: spec.name,
          purpose: spec.purpose,
          sourceUrl: spec.sourceUrl,
          attribution: spec.attribution,
          license: spec.license,
          updatedAt: 'Belum disinkronkan',
          fetchedAt: null,
          effectiveAt: null,
          freshness: 'stale',
          refreshSupported: true,
          parserVersion: FILTER_PARSER_VERSION,
          lastError: null,
          syntaxScope: spec.syntaxScope,
          status: 'degraded',
          totalLines: 0,
          supportedNetworkRules: 0,
          skippedRules: 0,
          parseErrors: 0,
        },
        allowRules: [],
        blockRules: [],
      });
    }

    this.activeEngine = this.rebuildEngine();
  }

  private getEffectiveFreshness(meta: FilterSourceMetadata): FilterSourceMetadata {
    if (meta.freshness === 'fresh' && meta.fetchedAt) {
      const fetchedTime = Date.parse(meta.fetchedAt);
      if (Number.isFinite(fetchedTime) && this.now().getTime() - fetchedTime > this.maxAgeMs) {
        return {
          ...meta,
          freshness: 'stale',
        };
      }
    }
    return meta;
  }

  private rebuildEngine(): FilterEngine {
    const sources: FilterSourceMetadata[] = [this.baselineDataset.metadata];
    const allowRules: ParsedNetworkRule[] = [...this.baselineDataset.allowRules];
    const blockRules: ParsedNetworkRule[] = [...this.baselineDataset.blockRules];

    for (const id of this.remoteOrder) {
      const ds = this.remoteDatasets.get(id);
      if (!ds) continue;
      sources.push(this.getEffectiveFreshness(ds.metadata));
      allowRules.push(...ds.allowRules);
      blockRules.push(...ds.blockRules);
    }

    return new FilterEngine(sources, allowRules, blockRules);
  }

  getActiveEngine(): FilterEngine {
    // Re-evaluate freshness dynamically in case active feeds aged past maxAgeMs
    const sources = this.activeEngine.getSourcesStatus().map((src) =>
      this.getEffectiveFreshness(src),
    );
    const hasStaleShift = sources.some(
      (s, i) => s.freshness !== this.activeEngine.getSourcesStatus()[i]?.freshness,
    );
    if (hasStaleShift) {
      this.activeEngine = this.rebuildEngine();
    }
    return this.activeEngine;
  }

  getStatusSnapshot(): {
    sources: FilterSourceMetadata[];
    summary: {
      allowRulesCount: number;
      blockRulesCount: number;
      lastRefreshAttemptAt: string | null;
      parserVersion: string;
    };
  } {
    const engine = this.getActiveEngine();
    const counts = engine.getRuleCounts();
    return {
      sources: engine.getSourcesStatus(),
      summary: {
        ...counts,
        lastRefreshAttemptAt: this.lastRefreshAttemptAt,
        parserVersion: FILTER_PARSER_VERSION,
      },
    };
  }

  async refreshAll(): Promise<RefreshSummary> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.executeRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async executeRefresh(): Promise<RefreshSummary> {
    const attemptedIso = this.now().toISOString();
    this.lastRefreshAttemptAt = attemptedIso;

    const outcomes: SourceRefreshOutcome[] = [];
    let refreshedCount = 0;
    let unchangedCount = 0;
    let failedCount = 0;

    for (const id of this.remoteOrder) {
      const current = this.remoteDatasets.get(id);
      if (!current) continue;

      try {
        const fetched = await this.fetchSource(current.spec, {
          etag: current.metadata.etag,
          lastModified: current.metadata.lastModified,
        });

        if (fetched.kind === 'not-modified') {
          current.metadata = {
            ...current.metadata,
            fetchedAt: attemptedIso,
            etag: fetched.etag ?? current.metadata.etag,
            lastModified: fetched.lastModified ?? current.metadata.lastModified,
            freshness: current.allowRules.length + current.blockRules.length > 0 ? 'fresh' : 'stale',
            lastError: null,
          };
          unchangedCount += 1;
          outcomes.push({ id, outcome: 'not-modified' });
          continue;
        }

        if (!parseMimeType(fetched.contentType).startsWith('text/plain')) {
          throw new SourceFetchError(
            'Format Content-Type sumber bukan text/plain yang diharapkan.',
          );
        }

        if (Buffer.byteLength(fetched.text, 'utf8') > MAX_FILTER_BYTES) {
          throw new SourceFetchError(
            'Ukuran berkas daftar filter melebihi batas maksimum 8 MiB.',
          );
        }

        const textTrimmed = fetched.text.trim();
        if (!textTrimmed) {
          throw new SourceFetchError('Kandidat daftar filter kosong dan ditolak.');
        }

        const headLower = textTrimmed.slice(0, 512).toLowerCase();
        if (headLower.includes('<!doctype html') || headLower.includes('<html')) {
          throw new SourceFetchError('Respons sumber tampak berupa dokumen HTML, bukan daftar filter.');
        }

        const digest = crypto.createHash('sha256').update(fetched.text, 'utf8').digest('hex');
        if (
          current.spec.expectedSha256 &&
          digest !== current.spec.expectedSha256.toLowerCase()
        ) {
          throw new SourceFetchError('Verifikasi checksum SHA-256 daftar filter gagal.');
        }

        const candidate = parseFilterListText(fetched.text, {
          id: current.spec.id,
          name: current.spec.name,
          purpose: current.spec.purpose,
          sourceUrl: current.spec.sourceUrl,
          attribution: current.spec.attribution,
          license: current.spec.license,
          updatedAt: attemptedIso.slice(0, 10),
          fetchedAt: attemptedIso,
          effectiveAt: attemptedIso,
          freshness: 'fresh',
          refreshSupported: true,
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          sha256: digest,
          parserVersion: FILTER_PARSER_VERSION,
          lastError: null,
          syntaxScope: current.spec.syntaxScope,
        });

        if (candidate.metadata.supportedNetworkRules < this.minCandidateRules) {
          throw new SourceFetchError(
            `Kandidat hanya memuat ${candidate.metadata.supportedNetworkRules} aturan valid (minimum ${this.minCandidateRules}).`,
          );
        }

        const maxAllowedParseErrors = Math.max(
          20,
          Math.floor(candidate.metadata.totalLines * 0.25),
        );
        if (candidate.metadata.parseErrors > maxAllowedParseErrors) {
          throw new SourceFetchError('Kandidat daftar filter memiliki terlalu banyak kesalahan sintaks.');
        }

        this.remoteDatasets.set(id, {
          spec: current.spec,
          metadata: candidate.metadata,
          allowRules: candidate.allowRules,
          blockRules: candidate.blockRules,
        });
        refreshedCount += 1;
        outcomes.push({ id, outcome: 'updated' });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Pembaruan daftar filter gagal diproses.';
        const hasLastKnownGood = current.allowRules.length + current.blockRules.length > 0;
        current.metadata = {
          ...current.metadata,
          status: hasLastKnownGood ? 'degraded' : 'error',
          freshness: hasLastKnownGood ? 'stale' : 'error',
          lastError: message,
        };
        failedCount += 1;
        outcomes.push({ id, outcome: 'failed', error: message });
      }
    }

    this.activeEngine = this.rebuildEngine();

    return {
      sources: this.activeEngine.getSourcesStatus(),
      outcomes,
      refreshedCount,
      unchangedCount,
      failedCount,
      attemptedAt: attemptedIso,
    };
  }
}

export const defaultFilterSourceManager = new FilterSourceManager();

export function getActiveFilterEngine(): FilterEngine {
  return defaultFilterSourceManager.getActiveEngine();
}
