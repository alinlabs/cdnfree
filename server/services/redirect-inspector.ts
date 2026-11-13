import crypto from 'node:crypto';
import { MAX_REDIRECT_HOPS } from '../security/request-limits.ts';
import { evaluateFramePolicy } from '../security/response-sanitizer.ts';
import {
  InspectionPolicyError,
  type DnsLookupFn,
  type RedirectHopRecord,
  type ServerInspectionResult,
} from '../types/server.ts';
import { getAssetFilename } from '../../src/utils/asset-explorer.ts';
import {
  classifyResourceKind,
  detectCdnProvider,
} from '../../src/utils/classify-resource.ts';
import { FilterEngine } from './filter-engine.ts';
import { getActiveFilterEngine } from './filter-source-manager.ts';
import { detectClientSideRedirect } from './client-redirect.ts';
import { extractStaticHtmlIntelligence } from './html-extractor.ts';
import { safeFetchHop, type FetchHopFn } from './safe-fetch.ts';
import { defaultDnsLookup, resolveAndValidateUrl } from './url-policy.ts';

export interface InspectUrlOptions {
  includeStaticLinks?: boolean;
  includeResources?: boolean;
  enableFilterMatching?: boolean;
  warnSuspiciousLinks?: boolean;
  allowlistedHosts?: string[];
  rejectProtocolDowngrade?: boolean;
  dnsLookup?: DnsLookupFn;
  fetchHop?: FetchHopFn;
  filterEngine?: FilterEngine;
  signal?: AbortSignal;
}


export async function inspectUrlTarget(
  rawUrl: string,
  options: InspectUrlOptions = {},
): Promise<ServerInspectionResult> {
  const startedAt = Date.now();
  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const fetchHop = options.fetchHop ?? safeFetchHop;
  const filterEngine = options.filterEngine ?? getActiveFilterEngine();

  const initialTarget = await resolveAndValidateUrl(rawUrl, dnsLookup);
  const submittedUrl = initialTarget.normalizedUrl;

  let currentTarget = initialTarget;
  const initialLoopUrl = new URL(submittedUrl);
  initialLoopUrl.hash = '';
  const visitedUrls = new Set<string>([initialLoopUrl.toString()]);
  const redirects: RedirectHopRecord[] = [];
  let anyIdn = initialTarget.isIdn;

  for (let hopIndex = 0; hopIndex <= MAX_REDIRECT_HOPS; hopIndex += 1) {
    const outcome = await fetchHop(currentTarget, options.signal);

    if (outcome.kind === 'redirect') {
      if (redirects.length >= MAX_REDIRECT_HOPS) {
        throw new InspectionPolicyError(
          'TOO_MANY_REDIRECTS',
          `Rantai pengalihan melebihi batas maksimum ${MAX_REDIRECT_HOPS} langkah.`,
          422,
        );
      }

      let resolvedNextUrl: URL;
      try {
        resolvedNextUrl = new URL(outcome.location, currentTarget.normalizedUrl);
      } catch {
        throw new InspectionPolicyError(
          'INVALID_REDIRECT',
          'Alamat tujuan pengalihan (Location) tidak valid.',
          502,
        );
      }

      const hashlessNextUrl = new URL(resolvedNextUrl.toString());
      hashlessNextUrl.hash = '';
      const nextLoopKey = hashlessNextUrl.toString();
      const nextUrlString = resolvedNextUrl.toString();
      const downgraded =
        currentTarget.url.protocol === 'https:' &&
        resolvedNextUrl.protocol === 'http:';

      if (downgraded && options.rejectProtocolDowngrade) {
        throw new InspectionPolicyError(
          'PROHIBITED_DESTINATION',
          'Pengalihan menurunkan protokol dari HTTPS ke HTTP dan ditolak oleh kebijakan keamanan.',
          403,
        );
      }

      if (visitedUrls.has(nextLoopKey)) {
        throw new InspectionPolicyError(
          'REDIRECT_LOOP',
          'Terdeteksi pengalihan berulang (redirect loop) pada tautan tujuan.',
          422,
        );
      }

      const nextTarget = await resolveAndValidateUrl(nextUrlString, dnsLookup);
      const canonicalHashless = new URL(nextTarget.normalizedUrl);
      canonicalHashless.hash = '';
      visitedUrls.add(canonicalHashless.toString());
      anyIdn = anyIdn || nextTarget.isIdn;

      redirects.push({
        step: redirects.length + 1,
        url: currentTarget.normalizedUrl,
        host: currentTarget.hostname,
        statusCode: outcome.statusCode,
        reason: downgraded
          ? 'Pengalihan menurunkan protokol dari HTTPS ke HTTP.'
          : undefined,
      });

      currentTarget = nextTarget;
      continue;
    }

    if (outcome.kind === 'asset') {
      const resourceKind = classifyResourceKind(currentTarget.normalizedUrl, {
        mimeHint: outcome.contentType,
      });
      const filterResult = (options.enableFilterMatching ?? true)
        ? filterEngine.evaluateUrl(
            currentTarget.normalizedUrl,
            currentTarget.hostname,
            {
              kind: resourceKind,
              userAllowlistedHosts: options.allowlistedHosts,
            },
          )
        : {
            classification: 'allowed' as const,
            reason: undefined,
          };
      const assetId = `direct-${crypto
        .createHash('sha1')
        .update(currentTarget.normalizedUrl)
        .digest('hex')
        .slice(0, 12)}`;
      const directResource = {
        id: assetId,
        url: currentTarget.normalizedUrl,
        host: currentTarget.hostname,
        kind: resourceKind,
        mimeType: outcome.contentType,
        declaredBytes: outcome.declaredBytes,
        source: 'html-link' as const,
        observation: 'fetched' as const,
        classification: filterResult.classification,
        reason: filterResult.reason,
      };
      const flaggedCount = directResource.classification !== 'allowed' ? 1 : 0;
      const redirectWarnings = redirects.filter((r) => Boolean(r.reason)).length;

      return {
        id: crypto.randomUUID(),
        submittedUrl,
        finalUrl: currentTarget.normalizedUrl,
        page: {
          title: getAssetFilename(currentTarget.normalizedUrl),
          statusCode: outcome.statusCode,
          contentType: outcome.contentType,
          isIdn: anyIdn,
        },
        redirects,
        resources: [directResource],
        links: [],
        cdnHosts: [
          {
            host: currentTarget.hostname,
            provider: detectCdnProvider(currentTarget.hostname),
            resourceCount: 1,
          },
        ],
        summary: {
          inspectedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt),
          redirectCount: redirects.length,
          resourceCount: 1,
          blockedCount: 0,
          flaggedCount,
          reviewCount: redirectWarnings,
          unsafeSchemeCount: 0,
          limitations: [
            `Tujuan mengembalikan berkas langsung (${outcome.contentType}), bukan halaman HTML, sehingga pratinjau langsung berkas dan aset terkait ditampilkan.`,
          ],
        },
        preview: { mode: 'embeddable' },
      };
    }

    const clientRedirect = detectClientSideRedirect({
      html: outcome.bodyText,
      baseUrl: currentTarget.normalizedUrl,
      headers: outcome.headers,
    });

    if (clientRedirect) {
      if (redirects.length >= MAX_REDIRECT_HOPS) {
        throw new InspectionPolicyError(
          'TOO_MANY_REDIRECTS',
          `Rantai pengalihan melebihi batas maksimum ${MAX_REDIRECT_HOPS} langkah.`,
          422,
        );
      }

      const resolvedNextUrl = new URL(clientRedirect.targetUrl);
      const hashlessNextUrl = new URL(resolvedNextUrl.toString());
      hashlessNextUrl.hash = '';
      const nextLoopKey = hashlessNextUrl.toString();
      const downgraded =
        currentTarget.url.protocol === 'https:' &&
        resolvedNextUrl.protocol === 'http:';

      if (downgraded && options.rejectProtocolDowngrade) {
        throw new InspectionPolicyError(
          'PROHIBITED_DESTINATION',
          'Pengalihan menurunkan protokol dari HTTPS ke HTTP dan ditolak oleh kebijakan keamanan.',
          403,
        );
      }

      if (visitedUrls.has(nextLoopKey)) {
        throw new InspectionPolicyError(
          'REDIRECT_LOOP',
          'Terdeteksi pengalihan berulang (redirect loop) pada tautan tujuan.',
          422,
        );
      }

      const nextTarget = await resolveAndValidateUrl(
        resolvedNextUrl.toString(),
        dnsLookup,
      );
      const canonicalHashless = new URL(nextTarget.normalizedUrl);
      canonicalHashless.hash = '';
      visitedUrls.add(canonicalHashless.toString());
      anyIdn = anyIdn || nextTarget.isIdn;

      redirects.push({
        step: redirects.length + 1,
        url: currentTarget.normalizedUrl,
        host: currentTarget.hostname,
        statusCode: outcome.statusCode,
        reason: downgraded
          ? `${clientRedirect.reason} Pengalihan menurunkan protokol dari HTTPS ke HTTP.`
          : clientRedirect.reason,
      });

      currentTarget = nextTarget;
      continue;
    }

    // Final HTML document reached — perform static extraction without executing scripts
    const extraction = extractStaticHtmlIntelligence(
      outcome.bodyText,
      currentTarget.normalizedUrl,
      {
        includeStaticLinks: options.includeStaticLinks ?? true,
        includeResources: options.includeResources ?? true,
        enableFilterMatching: options.enableFilterMatching ?? true,
        warnSuspiciousLinks: options.warnSuspiciousLinks ?? true,
        filterEngine,
        userAllowlistedHosts: options.allowlistedHosts,
      },
    );

    const framePolicy = evaluateFramePolicy(
      outcome.headers['x-frame-options'],
      outcome.headers['content-security-policy'],
    );

    const flaggedResources = extraction.resources.filter(
      (r) => r.classification !== 'allowed' && r.classification !== 'unknown',
    ).length;
    const flaggedLinks = extraction.links.filter(
      (l) => l.classification !== 'ordinary' && l.classification !== 'unknown',
    ).length;
    const reviewLinks = extraction.links.filter(
      (l) =>
        l.classification === 'suspicious' ||
        l.classification === 'ad-or-tracker' ||
        l.classification === 'known-malicious',
    ).length;
    const redirectWarnings = redirects.filter((r) => Boolean(r.reason)).length;

    const limitations = [
      'Inspeksi HTML statis tidak mengeksekusi JavaScript, sehingga aset yang dimuat dinamis oleh skrip tidak selalu terlihat.',
      'Kecocokan daftar filter bersifat indikasi berdasarkan pola jaringan, bukan bukti mutlak konten berbahaya.',
    ];

    if (extraction.unsafeSchemeCount > 0) {
      limitations.push(
        `Menolak ${extraction.unsafeSchemeCount} referensi dengan skema tidak aman (${extraction.unsafeSchemesSeen.join(', ')}).`,
      );
    }

    if (extraction.metaRefreshHint) {
      limitations.push(
        extraction.metaRefreshHint.targetUrl
          ? `Halaman memuat tag meta refresh menuju ${extraction.metaRefreshHint.targetUrl} (tidak diikuti otomatis).`
          : 'Halaman memuat tag meta refresh dengan target yang ditolak atau tidak valid.',
      );
    }

    if (!framePolicy.embeddable && framePolicy.reason) {
      limitations.push(framePolicy.reason);
    }

    return {
      id: crypto.randomUUID(),
      submittedUrl,
      finalUrl: currentTarget.normalizedUrl,
      page: {
        title: extraction.title,
        description: extraction.description,
        canonicalUrl: extraction.canonicalUrl,
        statusCode: outcome.statusCode,
        contentType: outcome.contentType,
        isIdn: anyIdn,
        metaRefreshHint: extraction.metaRefreshHint,
      },
      redirects,
      resources: extraction.resources,
      links: extraction.links,
      cdnHosts: extraction.cdnHosts,
      summary: {
        inspectedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAt),
        redirectCount: redirects.length,
        resourceCount: extraction.resources.length,
        blockedCount: 0, // Static inspection discovers & flags; never fabricates runtime block counts
        flaggedCount: flaggedResources + flaggedLinks,
        reviewCount: reviewLinks + redirectWarnings,
        unsafeSchemeCount: extraction.unsafeSchemeCount,
        limitations,
      },
      preview: framePolicy.embeddable
        ? { mode: 'embeddable' }
        : { mode: 'external-only', reason: framePolicy.reason },
    };
  }

  throw new InspectionPolicyError(
    'TOO_MANY_REDIRECTS',
    `Rantai pengalihan melebihi batas maksimum ${MAX_REDIRECT_HOPS} langkah.`,
    422,
  );
}
