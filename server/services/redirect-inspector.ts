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
import {
  scanSecondaryAssets,
  type SecondaryFetchFn,
} from './deep-asset-scanner.ts';
import {
  buildEmptyKindCounts,
  buildHlsPath,
  buildStreamPath,
  runAssetExtractionAndProbe,
} from './asset-pipeline-bridge.ts';
import { classifyAsset } from './asset-classify.ts';
import type { ProbeFetchFn } from './asset-probe.ts';
import { sniffKind } from './content-sniff.ts';
import { buildCdnHostSummaries, extractStaticHtmlIntelligence } from './html-extractor.ts';
import { reconcile } from './reconcile.ts';
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
  fetchSecondary?: SecondaryFetchFn;
  fetchRange?: ProbeFetchFn;
  filterEngine?: FilterEngine;
  signal?: AbortSignal;
}

export async function inspectUrlTarget(
  rawUrl: string,
  options: InspectUrlOptions = {},
): Promise<ServerInspectionResult> {
  const startedAt = Date.now();
  const inspectionId = crypto.randomUUID();
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
      const baseAssetKind =
        outcome.assetKind ??
        classifyAsset({
          url: currentTarget.normalizedUrl,
          mime: outcome.contentType,
        });
      const isHlsOrDash =
        baseAssetKind === 'hls' ||
        baseAssetKind === 'dash' ||
        /mpegurl|dash\+xml/i.test(outcome.contentType) ||
        /\.(m3u8|mpd)(?:\?|$)/i.test(currentTarget.normalizedUrl);
      const assetKind: 'hls' | 'dash' | typeof baseAssetKind = isHlsOrDash
        ? /\.mpd(?:\?|$)/i.test(currentTarget.normalizedUrl) ||
          /dash\+xml/i.test(outcome.contentType)
          ? 'dash'
          : 'hls'
        : baseAssetKind;
      const resourceKind =
        assetKind === 'hls' || assetKind === 'dash'
          ? 'video'
          : classifyResourceKind(currentTarget.normalizedUrl, {
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
      const hlsPath =
        assetKind === 'hls' || assetKind === 'dash'
          ? buildHlsPath(inspectionId, assetId)
          : undefined;
      const directResource = {
        id: assetId,
        url: currentTarget.normalizedUrl,
        host: currentTarget.hostname,
        kind: resourceKind,
        assetKind,
        mimeType: outcome.contentType,
        declaredBytes: outcome.declaredBytes,
        streamUrl: hlsPath ?? buildStreamPath(inspectionId, assetId),
        hlsUrl: hlsPath,
        referer: submittedUrl,
        depth: 0,
        probe: {
          status: 'verified' as const,
          reason: 'ok' as const,
          httpStatus: outcome.statusCode,
          mime: outcome.contentType,
          bytes: outcome.declaredBytes,
        },
        source: 'html-link' as const,
        observation: 'fetched' as const,
        classification: filterResult.classification,
        reason: filterResult.reason,
      };
      const flaggedCount = directResource.classification !== 'allowed' ? 1 : 0;
      const redirectWarnings = redirects.filter((r) => Boolean(r.reason)).length;
      const directByKind = buildEmptyKindCounts();
      directByKind[assetKind] = 1;

      return {
        id: inspectionId,
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
        extraction: {
          candidates: 1,
          resolved: 1,
          deduped: 1,
          byKind: directByKind,
          dropped: [],
          verifiedCount: 1,
          unverifiedCount: 0,
        },
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

    // Final HTML document reached — perform static extraction + secondary deep scan + probe
    const includeResources = options.includeResources ?? true;
    const enableFilterMatching = options.enableFilterMatching ?? true;
    const htmlExtraction = extractStaticHtmlIntelligence(
      outcome.bodyText,
      currentTarget.normalizedUrl,
      {
        includeStaticLinks: options.includeStaticLinks ?? true,
        includeResources,
        enableFilterMatching,
        warnSuspiciousLinks: options.warnSuspiciousLinks ?? true,
        filterEngine,
        userAllowlistedHosts: options.allowlistedHosts,
      },
    );

    let finalResources = htmlExtraction.resources;
    let finalCdnHosts = htmlExtraction.cdnHosts;

    if (includeResources && (!options.fetchHop || options.fetchSecondary)) {
      const secondaryResult = await scanSecondaryAssets({
        extraction: htmlExtraction,
        finalUrl: currentTarget.normalizedUrl,
        pageHost: currentTarget.hostname,
        filterEngine,
        enableFilterMatching,
        allowlistedHosts: options.allowlistedHosts ?? [],
        dnsLookup,
        fetchSecondary: options.fetchSecondary,
        signal: options.signal,
      });
      finalResources = secondaryResult.resources;
      finalCdnHosts = secondaryResult.cdnHosts;
    }

    let extractionTelemetry: ServerInspectionResult['extraction'];
    if (includeResources) {
      const bridged = await runAssetExtractionAndProbe({
        inspectionId,
        html: outcome.bodyText,
        finalUrl: currentTarget.normalizedUrl,
        pageHost: currentTarget.hostname,
        baseResources: finalResources,
        filterEngine,
        enableFilterMatching,
        allowlistedHosts: options.allowlistedHosts ?? [],
        shouldProbe: !options.fetchHop || Boolean(options.fetchRange),
        dnsLookup,
        fetchRange: options.fetchRange,
        signal: options.signal,
      });
      finalResources = bridged.resources;
      finalCdnHosts = buildCdnHostSummaries(finalResources);
      extractionTelemetry = bridged.extraction;

      const bodyHead = Buffer.from(outcome.bodyText.slice(0, 2048), 'utf8');
      const isWrapper =
        Boolean(outcome.isWrapper) ||
        reconcile(
          outcome.contentType,
          sniffKind(bodyHead),
          currentTarget.normalizedUrl,
          bodyHead,
        ).wrapper;

      if (isWrapper) {
        const wrapperId = `wrapper-${crypto
          .createHash('sha1')
          .update(currentTarget.normalizedUrl)
          .digest('hex')
          .slice(0, 12)}`;
        const existingIdx = finalResources.findIndex(
          (r) => r.url === currentTarget.normalizedUrl,
        );
        const wrapperRecord = {
          id: existingIdx >= 0 ? finalResources[existingIdx].id : wrapperId,
          url: currentTarget.normalizedUrl,
          host: currentTarget.hostname,
          kind: 'other' as const,
          assetKind: 'wrapper' as const,
          mimeType: 'text/html; charset=utf-8',
          referer: submittedUrl,
          depth: 0,
          probe: {
            status: 'unverified' as const,
            reason: 'html-wrapper' as const,
            httpStatus: outcome.statusCode,
            mime: 'text/html; charset=utf-8',
          },
          source: 'html-link' as const,
          observation: 'fetched' as const,
          classification: 'allowed' as const,
        };
        if (existingIdx >= 0) {
          finalResources[existingIdx] = wrapperRecord;
        } else {
          finalResources.unshift(wrapperRecord);
        }
        extractionTelemetry.byKind.wrapper += 1;
        extractionTelemetry.unverifiedCount += 1;
        finalCdnHosts = buildCdnHostSummaries(finalResources);
      }
    } else {
      extractionTelemetry = {
        candidates: 0,
        resolved: 0,
        deduped: 0,
        byKind: buildEmptyKindCounts(),
        dropped: [],
        verifiedCount: 0,
        unverifiedCount: 0,
      };
    }

    const framePolicy = evaluateFramePolicy(
      outcome.headers['x-frame-options'],
      outcome.headers['content-security-policy'],
    );

    const flaggedResources = finalResources.filter(
      (r) => r.classification !== 'allowed' && r.classification !== 'unknown',
    ).length;
    const flaggedLinks = htmlExtraction.links.filter(
      (l) => l.classification !== 'ordinary' && l.classification !== 'unknown',
    ).length;
    const reviewLinks = htmlExtraction.links.filter(
      (l) =>
        l.classification === 'suspicious' ||
        l.classification === 'ad-or-tracker' ||
        l.classification === 'known-malicious',
    ).length;
    const redirectWarnings = redirects.filter((r) => Boolean(r.reason)).length;

    const limitations = [
      'Inspeksi server menganalisis HTML statis, stylesheet eksternal (@font-face/@import/url), JSON-LD, web manifest, iframe tertanam, dan probe Range non-destruktif tanpa menjalankan runtime JavaScript penuh.',
      'Kecocokan daftar filter bersifat indikasi berdasarkan pola jaringan, bukan bukti mutlak konten berbahaya.',
    ];

    if (htmlExtraction.unsafeSchemeCount > 0) {
      limitations.push(
        `Menolak ${htmlExtraction.unsafeSchemeCount} referensi dengan skema tidak aman (${htmlExtraction.unsafeSchemesSeen.join(', ')}).`,
      );
    }

    if (htmlExtraction.metaRefreshHint) {
      limitations.push(
        htmlExtraction.metaRefreshHint.targetUrl
          ? `Halaman memuat tag meta refresh menuju ${htmlExtraction.metaRefreshHint.targetUrl} (tidak diikuti otomatis).`
          : 'Halaman memuat tag meta refresh dengan target yang ditolak atau tidak valid.',
      );
    }

    if (!framePolicy.embeddable && framePolicy.reason) {
      limitations.push(framePolicy.reason);
    }

    return {
      id: inspectionId,
      submittedUrl,
      finalUrl: currentTarget.normalizedUrl,
      page: {
        title: htmlExtraction.title,
        description: htmlExtraction.description,
        canonicalUrl: htmlExtraction.canonicalUrl,
        statusCode: outcome.statusCode,
        contentType: outcome.contentType,
        isIdn: anyIdn,
        metaRefreshHint: htmlExtraction.metaRefreshHint,
      },
      redirects,
      resources: finalResources,
      links: htmlExtraction.links,
      cdnHosts: finalCdnHosts,
      extraction: extractionTelemetry,
      summary: {
        inspectedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAt),
        redirectCount: redirects.length,
        resourceCount: finalResources.length,
        blockedCount: 0, // Static inspection discovers & flags; never fabricates runtime block counts
        flaggedCount: flaggedResources + flaggedLinks,
        reviewCount: reviewLinks + redirectWarnings,
        unsafeSchemeCount: htmlExtraction.unsafeSchemeCount,
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
