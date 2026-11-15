import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveInspectionDetails,
  getHostnameSafe,
  getResourceKindLabelId,
  getReviewClassificationLabel,
} from '../../src/utils/inspection-details.ts';
import type { InspectionResult } from '../../src/types/inspection.ts';

function buildBaseResult(overrides: Partial<InspectionResult> = {}): InspectionResult {
  return {
    id: 'insp-1',
    submittedUrl: 'https://short.example/go?token=secret-token&ref=home',
    finalUrl: 'https://dest.example/article?utm_source=test',
    page: {
      title: 'Artikel Contoh',
      description: 'Ringkasan halaman contoh',
      canonicalUrl: 'https://dest.example/article',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      isIdn: false,
    },
    redirects: [
      {
        step: 1,
        url: 'https://short.example/go?token=secret-token&ref=home',
        host: 'short.example',
        statusCode: 302,
      },
    ],
    resources: [
      {
        id: 'r1',
        url: 'https://cdn.example/app.js',
        host: 'cdn.example',
        kind: 'script',
        source: 'html-script',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'r2',
        url: 'https://tracker.example/pixel.js',
        host: 'tracker.example',
        kind: 'script',
        source: 'html-script',
        observation: 'discovered',
        classification: 'ad-or-tracker',
        reason: 'Cocok aturan EasyList pasif.',
      },
    ],
    links: [
      {
        id: 'l1',
        href: 'https://dest.example/about',
        host: 'dest.example',
        text: 'Tentang',
        classification: 'ordinary',
      },
      {
        id: 'l2',
        href: 'https://promo.example/click',
        host: 'promo.example',
        text: 'Unduh file',
        classification: 'suspicious',
        evidence: ['Teks tautan tidak sesuai domain tujuan.'],
      },
    ],
    cdnHosts: [
      { host: 'cdn.example', provider: null, resourceCount: 1 },
      { host: 'tracker.example', provider: null, resourceCount: 1 },
    ],
    summary: {
      inspectedAt: '2026-11-13T10:00:00.000Z',
      durationMs: 245,
      redirectCount: 1,
      resourceCount: 2,
      blockedCount: 0,
      flaggedCount: 2,
      reviewCount: 2,
      unsafeSchemeCount: 0,
      limitations: [
        'Inspeksi statis tidak menjalankan JavaScript.',
        'Inspeksi statis tidak menjalankan JavaScript.',
      ],
    },
    preview: {
      mode: 'embeddable',
    },
    ...overrides,
  };
}

test('deriveInspectionDetails redacts URLs, filters review items, and deduplicates limitations', () => {
  const details = deriveInspectionDetails(buildBaseResult());

  assert.equal(details.originHost, 'short.example');
  assert.equal(details.finalHost, 'dest.example');
  assert.equal(details.urlsDiffer, true);
  assert.match(details.submittedDisplayUrl, /token=REDACTED/);
  assert.doesNotMatch(details.submittedDisplayUrl, /secret-token/);
  assert.equal(details.canonicalDisplayUrl, 'https://dest.example/article');
  assert.equal(details.hasRedirects, true);
  assert.equal(details.reviewLinks.length, 1);
  assert.equal(details.flaggedResources.length, 1);
  assert.equal(details.reviewTotalCount, 2);
  assert.deepEqual(details.limitations, [
    'Inspeksi statis tidak menjalankan JavaScript.',
  ]);
});

test('deriveInspectionDetails omits redundant canonical URL and provides fallback limitation', () => {
  const details = deriveInspectionDetails(
    buildBaseResult({
      submittedUrl: 'https://same.example/page',
      finalUrl: 'https://same.example/page',
      page: {
        statusCode: 200,
        contentType: 'text/html',
        isIdn: false,
        canonicalUrl: 'https://same.example/page',
      },
      redirects: [],
      resources: [],
      links: [],
      summary: {
        inspectedAt: '2026-11-13T10:00:00.000Z',
        durationMs: 120,
        redirectCount: 0,
        resourceCount: 0,
        blockedCount: 0,
        flaggedCount: 0,
        reviewCount: 0,
        unsafeSchemeCount: 0,
        limitations: [],
      },
    }),
  );

  assert.equal(details.urlsDiffer, false);
  assert.equal(details.canonicalDisplayUrl, undefined);
  assert.equal(details.hasRedirects, false);
  assert.equal(details.reviewTotalCount, 0);
  assert.equal(details.limitations.length, 1);
});

test('getHostnameSafe and Indonesian label helpers return accurate labels', () => {
  assert.equal(getHostnameSafe('https://sub.example.com/a'), 'sub.example.com');
  assert.equal(getHostnameSafe('not-a-url'), 'not-a-url');
  assert.equal(getResourceKindLabelId('script'), 'Skrip');
  assert.equal(getResourceKindLabelId('image'), 'Gambar');
  assert.equal(getReviewClassificationLabel('known-malicious'), 'Terdaftar berisiko');
  assert.equal(getReviewClassificationLabel('ad-or-tracker'), 'Cocok daftar filter');
  assert.equal(getReviewClassificationLabel('suspicious'), 'Perlu ditinjau');
});
