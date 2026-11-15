import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResourceKind } from '../../src/utils/classify-resource.ts';
import { isSameSiteHost } from './public-suffix.ts';

export const FILTER_PARSER_VERSION = '1.2.0';

export type FilterSourceFreshness = 'fresh' | 'fallback' | 'stale' | 'error';

export interface FilterSourceMetadata {
  id: string;
  name: string;
  purpose: string;
  sourceUrl: string;
  attribution: string;
  license: string;
  updatedAt: string;
  fetchedAt: string | null;
  effectiveAt: string | null;
  freshness: FilterSourceFreshness;
  refreshSupported: boolean;
  etag?: string;
  lastModified?: string;
  sha256?: string;
  parserVersion: string;
  lastError?: string | null;
  syntaxScope: string;
  status: 'active' | 'degraded' | 'error';
  totalLines: number;
  supportedNetworkRules: number;
  skippedRules: number;
  parseErrors: number;
}

export type FilterSourceInputMeta = Pick<
  FilterSourceMetadata,
  'id' | 'name' | 'sourceUrl' | 'attribution' | 'license' | 'updatedAt' | 'syntaxScope'
> &
  Partial<
    Pick<
      FilterSourceMetadata,
      | 'purpose'
      | 'fetchedAt'
      | 'effectiveAt'
      | 'freshness'
      | 'refreshSupported'
      | 'etag'
      | 'lastModified'
      | 'sha256'
      | 'parserVersion'
      | 'lastError'
    >
  >;

export interface ParsedNetworkRule {
  raw: string;
  isException: boolean;
  anchorDomain?: string;
  pathSubstring?: string;
  thirdPartyOnly: boolean;
  resourceTypes?: Set<ResourceKind>;
  sourceId: string;
  sourceName: string;
}

export interface FilterMatchResult {
  matched: boolean;
  classification: 'allowed' | 'ad-or-tracker';
  decision: 'allowed_by_user' | 'allowed_by_exception' | 'matched_block_rule' | 'no_match';
  rule?: string;
  sourceId?: string;
  sourceName?: string;
  reason?: string;
}

const OPTION_TYPE_MAP: Record<string, ResourceKind> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  font: 'font',
  media: 'video',
  subdocument: 'document',
};

function matchesDomainAnchor(hostname: string, anchorDomain: string): boolean {
  const host = hostname.toLowerCase();
  const domain = anchorDomain.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export function isThirdPartyHost(targetHost: string, pageHost: string): boolean {
  return !isSameSiteHost(targetHost, pageHost);
}

function indexRules(rules: ParsedNetworkRule[]): {
  byDomain: Map<string, ParsedNetworkRule[]>;
  pathOnly: ParsedNetworkRule[];
} {
  const byDomain = new Map<string, ParsedNetworkRule[]>();
  const pathOnly: ParsedNetworkRule[] = [];

  for (const rule of rules) {
    if (rule.anchorDomain) {
      const bucket = byDomain.get(rule.anchorDomain);
      if (bucket) {
        bucket.push(rule);
      } else {
        byDomain.set(rule.anchorDomain, [rule]);
      }
    } else {
      pathOnly.push(rule);
    }
  }

  return { byDomain, pathOnly };
}

export function parseFilterListText(
  text: string,
  sourceMeta: FilterSourceInputMeta,
): {
  metadata: FilterSourceMetadata;
  allowRules: ParsedNetworkRule[];
  blockRules: ParsedNetworkRule[];
} {
  const lines = text.split(/\r?\n/);
  const allowRules: ParsedNetworkRule[] = [];
  const blockRules: ParsedNetworkRule[] = [];

  let skippedRules = 0;
  let parseErrors = 0;
  let detectedUpdatedAt = sourceMeta.updatedAt;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('!') || line.startsWith('[') || line.startsWith('#')) {
      // Adblock cosmetic rules can start with ## or #@#, handle comments separately
      if (!line.startsWith('##') && !line.startsWith('#@#') && !line.startsWith('#?#') && !line.startsWith('#$#')) {
        const modMatch = /^(?:!|#)\s*(?:Last modified|last updated):\s*(.+)$/i.exec(line);
        if (modMatch) {
          detectedUpdatedAt = modMatch[1].trim();
        }
        continue;
      }
    }

    // Cosmetic / element-hiding / scriptlet rules are out of scope for static network matcher
    if (
      line.includes('##') ||
      line.includes('#@#') ||
      line.includes('#?#') ||
      line.includes('#$#')
    ) {
      skippedRules += 1;
      continue;
    }

    let working = line;
    const isException = working.startsWith('@@');
    if (isException) {
      working = working.slice(2);
    }

    // Split network options after '$'
    let optionsRaw = '';
    const dollarIndex = working.indexOf('$');
    if (dollarIndex !== -1) {
      optionsRaw = working.slice(dollarIndex + 1);
      working = working.slice(0, dollarIndex);
    }

    let thirdPartyOnly = false;
    let resourceTypes: Set<ResourceKind> | undefined;
    let unsupportedOption = false;

    if (optionsRaw) {
      for (const opt of optionsRaw.split(',')) {
        const cleanOpt = opt.trim().toLowerCase();
        if (!cleanOpt) continue;
        if (cleanOpt === 'third-party' || cleanOpt === '3p') {
          thirdPartyOnly = true;
        } else if (cleanOpt in OPTION_TYPE_MAP) {
          resourceTypes ??= new Set();
          resourceTypes.add(OPTION_TYPE_MAP[cleanOpt]);
        } else {
          // Strict fail-skip for ANY unsupported modifier (e.g. $popup, $badfilter, $csp=, $domain=)
          // so we never silently drop conditions and accidentally over-block an entire domain.
          unsupportedOption = true;
          break;
        }
      }
    }

    const isRegexRule =
      working.startsWith('/') &&
      working.endsWith('/') &&
      working.length > 2 &&
      /[\\^$*+?()[\]{}|]/.test(working.slice(1, -1));

    if (unsupportedOption || isRegexRule) {
      skippedRules += 1;
      continue;
    }

    let rule: ParsedNetworkRule | null = null;

    if (working.startsWith('||')) {
      const body = working.slice(2);
      const separatorIdx = body.search(/[\^/]/);
      const domainPart = (separatorIdx === -1 ? body : body.slice(0, separatorIdx))
        .toLowerCase()
        .replace(/^\.+|\.+$/g, '');

      if (!domainPart || /[*?]/.test(domainPart) || !domainPart.includes('.')) {
        parseErrors += 1;
        continue;
      }

      let pathSubstring: string | undefined;
      if (separatorIdx !== -1) {
        const remainder = body.slice(separatorIdx);
        if (remainder === '^' || remainder === '/' || remainder === '^/') {
          pathSubstring = undefined;
        } else if (
          remainder.startsWith('^/') &&
          !remainder.slice(1).includes('*') &&
          !remainder.slice(1).includes('^')
        ) {
          pathSubstring = remainder.slice(1).toLowerCase();
        } else if (
          remainder.startsWith('/') &&
          !remainder.slice(0, -1).includes('*') &&
          !remainder.slice(0, -1).includes('^')
        ) {
          const cleanPath = remainder.replace(/[\^*]+$/, '');
          pathSubstring = cleanPath.length > 1 ? cleanPath.toLowerCase() : undefined;
        } else {
          // Unsupported wildcard/separator path after domain anchor — skip safely instead of broadening
          skippedRules += 1;
          continue;
        }
      }

      rule = {
        raw: line,
        isException,
        anchorDomain: domainPart,
        pathSubstring,
        thirdPartyOnly,
        resourceTypes,
        sourceId: sourceMeta.id,
        sourceName: sourceMeta.name,
      };
    } else if (working.startsWith('/') && working.length >= 4 && !working.includes('*')) {
      rule = {
        raw: line,
        isException,
        pathSubstring: working.toLowerCase(),
        thirdPartyOnly,
        resourceTypes,
        sourceId: sourceMeta.id,
        sourceName: sourceMeta.name,
      };
    } else {
      skippedRules += 1;
      continue;
    }

    if (isException) {
      allowRules.push(rule);
    } else {
      blockRules.push(rule);
    }
  }

  return {
    metadata: {
      id: sourceMeta.id,
      name: sourceMeta.name,
      purpose: sourceMeta.purpose ?? 'Deteksi aset dan tautan iklan atau pelacak jaringan',
      sourceUrl: sourceMeta.sourceUrl,
      attribution: sourceMeta.attribution,
      license: sourceMeta.license,
      updatedAt: detectedUpdatedAt,
      fetchedAt: sourceMeta.fetchedAt ?? null,
      effectiveAt: sourceMeta.effectiveAt ?? null,
      freshness: sourceMeta.freshness ?? 'fallback',
      refreshSupported: sourceMeta.refreshSupported ?? false,
      etag: sourceMeta.etag,
      lastModified: sourceMeta.lastModified,
      sha256: sourceMeta.sha256,
      parserVersion: sourceMeta.parserVersion ?? FILTER_PARSER_VERSION,
      lastError: sourceMeta.lastError ?? null,
      syntaxScope: sourceMeta.syntaxScope,
      status: 'active',
      totalLines: lines.length,
      supportedNetworkRules: allowRules.length + blockRules.length,
      skippedRules,
      parseErrors,
    },
    allowRules,
    blockRules,
  };
}

function ruleMatchesUrl(
  rule: ParsedNetworkRule,
  parsedUrl: URL,
  pageHost: string,
  kind?: ResourceKind,
): boolean {
  if (rule.thirdPartyOnly && !isThirdPartyHost(parsedUrl.hostname, pageHost)) {
    return false;
  }

  if (rule.resourceTypes && kind && !rule.resourceTypes.has(kind)) {
    return false;
  }

  if (rule.anchorDomain && !matchesDomainAnchor(parsedUrl.hostname, rule.anchorDomain)) {
    return false;
  }

  if (rule.pathSubstring) {
    const pathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`.toLowerCase();
    if (!pathAndQuery.includes(rule.pathSubstring)) {
      return false;
    }
  }

  return true;
}

function findMatchingRule(
  indexed: { byDomain: Map<string, ParsedNetworkRule[]>; pathOnly: ParsedNetworkRule[] },
  parsedUrl: URL,
  pageHost: string,
  kind?: ResourceKind,
): ParsedNetworkRule | null {
  const hostLower = parsedUrl.hostname.toLowerCase();
  const labels = hostLower.split('.').filter(Boolean);

  // Walk most-specific hostname suffix up to registrable domain / TLD in O(depth) lookups
  for (let i = 0; i < labels.length; i += 1) {
    const domainCandidate = labels.slice(i).join('.');
    const candidates = indexed.byDomain.get(domainCandidate);
    if (!candidates) continue;

    for (const rule of candidates) {
      if (ruleMatchesUrl(rule, parsedUrl, pageHost, kind)) {
        return rule;
      }
    }
  }

  for (const rule of indexed.pathOnly) {
    if (ruleMatchesUrl(rule, parsedUrl, pageHost, kind)) {
      return rule;
    }
  }

  return null;
}

export class FilterEngine {
  private readonly sources: FilterSourceMetadata[];
  private readonly allowRules: ParsedNetworkRule[];
  private readonly blockRules: ParsedNetworkRule[];
  private readonly allowIndex: ReturnType<typeof indexRules>;
  private readonly blockIndex: ReturnType<typeof indexRules>;

  constructor(
    sources: FilterSourceMetadata[],
    allowRules: ParsedNetworkRule[],
    blockRules: ParsedNetworkRule[],
  ) {
    this.sources = sources;
    this.allowRules = allowRules;
    this.blockRules = blockRules;
    this.allowIndex = indexRules(allowRules);
    this.blockIndex = indexRules(blockRules);
  }

  getSourcesStatus(): FilterSourceMetadata[] {
    return this.sources;
  }

  getRuleCounts(): { allowRulesCount: number; blockRulesCount: number } {
    return {
      allowRulesCount: this.allowRules.length,
      blockRulesCount: this.blockRules.length,
    };
  }

  evaluateUrl(
    rawUrl: string,
    pageHost: string,
    options?: {
      kind?: ResourceKind;
      userAllowlistedHosts?: string[];
    },
  ): FilterMatchResult {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { matched: false, classification: 'allowed', decision: 'no_match' };
    }

    const hostLower = parsed.hostname.toLowerCase();
    const userAllowlist = options?.userAllowlistedHosts ?? [];
    if (
      userAllowlist.some((allowedHost) => {
        const clean = allowedHost.trim().toLowerCase();
        return clean.length > 0 && clean === hostLower;
      })
    ) {
      return {
        matched: false,
        classification: 'allowed',
        decision: 'allowed_by_user',
        reason: `Diizinkan oleh pengecualian host pengguna (${hostLower}).`,
      };
    }

    // Exception rules (@@) across all active sources take strict precedence over block rules
    const matchedAllow = findMatchingRule(this.allowIndex, parsed, pageHost, options?.kind);
    if (matchedAllow) {
      return {
        matched: false,
        classification: 'allowed',
        decision: 'allowed_by_exception',
        rule: matchedAllow.raw,
        sourceId: matchedAllow.sourceId,
        sourceName: matchedAllow.sourceName,
        reason: `Dikecualikan oleh aturan daftar filter ${matchedAllow.sourceName} (${matchedAllow.raw}).`,
      };
    }

    const matchedBlock = findMatchingRule(this.blockIndex, parsed, pageHost, options?.kind);
    if (matchedBlock) {
      return {
        matched: true,
        classification: 'ad-or-tracker',
        decision: 'matched_block_rule',
        rule: matchedBlock.raw,
        sourceId: matchedBlock.sourceId,
        sourceName: matchedBlock.sourceName,
        reason: `Cocok dengan daftar filter ${matchedBlock.sourceName} (${matchedBlock.raw}).`,
      };
    }

    return { matched: false, classification: 'allowed', decision: 'no_match' };
  }
}

export function createBaselineFilterDataset(): {
  metadata: FilterSourceMetadata;
  allowRules: ParsedNetworkRule[];
  blockRules: ParsedNetworkRule[];
} {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(currentDir, '../data/baseline-filters.txt'),
    path.resolve(process.cwd(), 'server/data/baseline-filters.txt'),
    path.resolve(currentDir, '../server/data/baseline-filters.txt'),
    path.resolve(currentDir, 'server/data/baseline-filters.txt'),
  ];
  const baselinePath =
    candidatePaths.find((candidate) => fs.existsSync(candidate)) ??
    candidatePaths[0];

  const baseMeta: FilterSourceInputMeta = {
    id: 'cdnfree-baseline-easylist',
    name: 'CDNFREE Baseline (Cadangan Bawaan)',
    purpose: 'Cadangan aturan dasar domain iklan & pelacak ketika daftar jarak jauh belum disinkronkan',
    sourceUrl: 'https://easylist.to/',
    attribution: 'EasyList & EasyPrivacy Authors (https://easylist.to/)',
    license: 'CC BY-SA 3.0 / GPLv3',
    updatedAt: '2026-11-13',
    fetchedAt: null,
    effectiveAt: '2026-11-13T00:00:00.000Z',
    freshness: 'fallback',
    refreshSupported: false,
    parserVersion: FILTER_PARSER_VERSION,
    lastError: null,
    syntaxScope:
      'Cadangan lokal luring (44 aturan). Subset aturan jaringan (||domain^, @@||domain^, jalur statis, $third-party). Bukan kompatibilitas penuh uBlock Origin.',
  };

  try {
    const content = fs.readFileSync(baselinePath, 'utf8');
    const parsed = parseFilterListText(content, baseMeta);
    return {
      metadata: {
        ...parsed.metadata,
        freshness: 'fallback',
      },
      allowRules: parsed.allowRules,
      blockRules: parsed.blockRules,
    };
  } catch {
    return {
      metadata: {
        ...baseMeta,
        purpose:
          baseMeta.purpose ??
          'Cadangan aturan dasar domain iklan & pelacak ketika daftar jarak jauh belum disinkronkan',
        fetchedAt: baseMeta.fetchedAt ?? null,
        effectiveAt: baseMeta.effectiveAt ?? null,
        freshness: 'error',
        refreshSupported: baseMeta.refreshSupported ?? false,
        parserVersion: baseMeta.parserVersion ?? FILTER_PARSER_VERSION,
        status: 'error',
        lastError: 'Berkas cadangan daftar filter bawaan tidak dapat dibaca.',
        totalLines: 0,
        supportedNetworkRules: 0,
        skippedRules: 0,
        parseErrors: 1,
      },
      allowRules: [],
      blockRules: [],
    };
  }
}

export function createDefaultFilterEngine(): FilterEngine {
  const baseline = createBaselineFilterDataset();
  return new FilterEngine([baseline.metadata], baseline.allowRules, baseline.blockRules);
}

export const defaultFilterEngine = createDefaultFilterEngine();

