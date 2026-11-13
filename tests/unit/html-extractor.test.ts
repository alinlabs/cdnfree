import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyResourceKind,
  detectCdnProvider,
} from '../../src/utils/classify-resource.ts';
import { extractStaticHtmlIntelligence } from '../../server/services/html-extractor.ts';
import {
  BASE_AND_MEDIA_FIXTURE,
  MALFORMED_AND_UNSAFE_FIXTURE,
  ORDINARY_HTML_FIXTURE,
} from '../fixtures/html-pages.ts';

test('classifyResourceKind and detectCdnProvider classify assets accurately without guessing', () => {
  assert.equal(classifyResourceKind('https://cdn.example/a.woff2'), 'font');
  assert.equal(classifyResourceKind('https://cdn.example/v.mp4'), 'video');
  assert.equal(classifyResourceKind('https://cdn.example/a.mp3'), 'audio');
  assert.equal(classifyResourceKind('https://cdn.example/s.css'), 'stylesheet');
  assert.equal(classifyResourceKind('https://cdn.example/app.js'), 'script');
  assert.equal(classifyResourceKind('https://cdn.example/pic.webp'), 'image');
  assert.equal(classifyResourceKind('https://cdn.example/unknown-endpoint'), 'other');

  assert.equal(detectCdnProvider('d1234.cloudfront.net'), 'Amazon CloudFront');
  assert.equal(detectCdnProvider('cdn.jsdelivr.net'), 'jsDelivr');
  assert.equal(detectCdnProvider('unknown-origin.example.org'), null);
});

test('extractStaticHtmlIntelligence extracts ordinary page metadata, CDN hosts, and filter matches', () => {
  const out = extractStaticHtmlIntelligence(
    ORDINARY_HTML_FIXTURE,
    'https://portal.example/berita/utama',
  );

  assert.equal(out.title, 'Portal Berita Contoh');
  assert.equal(out.description, 'Artikel berita teknologi dan keamanan web.');
  assert.equal(out.canonicalUrl, 'https://portal.example/berita/utama');

  const gtm = out.resources.find((r) => r.host === 'www.googletagmanager.com');
  assert.ok(gtm);
  assert.equal(gtm.classification, 'ad-or-tracker');
  assert.equal(gtm.observation, 'discovered');

  // Exception rule @@||cdn.jsdelivr.net^ keeps jsDelivr allowed
  const jsdelivr = out.resources.find((r) => r.host === 'cdn.jsdelivr.net');
  assert.ok(jsdelivr);
  assert.equal(jsdelivr.classification, 'allowed');

  // Ordinary third-party partner link is not flagged
  const partnerLink = out.links.find((l) => l.host === 'mitra.example.org');
  assert.ok(partnerLink);
  assert.equal(partnerLink.classification, 'ordinary');

  assert.ok(
    out.cdnHosts.some(
      (c) => c.host === 'd1234.cloudfront.net' && c.provider === 'Amazon CloudFront',
    ),
  );
});

test('extractStaticHtmlIntelligence resolves <base>, picture/video/audio sources, and meta refresh hint', () => {
  const out = extractStaticHtmlIntelligence(
    BASE_AND_MEDIA_FIXTURE,
    'https://portal.example/page',
  );

  assert.equal(out.effectiveBaseUrl, 'https://static.example.com/assets/');
  assert.equal(out.metaRefreshHint?.delaySeconds, 5);
  assert.equal(
    out.metaRefreshHint?.targetUrl,
    'https://next.example.com/landing',
  );

  assert.ok(
    out.resources.some(
      (r) =>
        r.url === 'https://static.example.com/assets/videos/intro.mp4' &&
        r.kind === 'video',
    ),
  );
  assert.ok(
    out.resources.some(
      (r) =>
        r.url === 'https://static.example.com/assets/audio/podcast.mp3' &&
        r.kind === 'audio',
    ),
  );
  assert.ok(
    out.resources.some(
      (r) =>
        r.url === 'https://static.example.com/assets/images/cover.avif' &&
        r.kind === 'image',
    ),
  );
  assert.ok(
    out.links.some(
      (l) => l.href === 'https://static.example.com/assets/halaman-dua.html',
    ),
  );
});

test('extractStaticHtmlIntelligence handles malformed HTML, deduplicates, rejects unsafe schemes, and flags misleading anchors', () => {
  const out = extractStaticHtmlIntelligence(
    MALFORMED_AND_UNSAFE_FIXTURE,
    'https://portal.example/',
  );

  assert.equal(out.description, 'Deskripsi tetap terbaca');
  assert.equal(out.metaRefreshHint?.unsafeTargetRejected, true);
  assert.equal(out.metaRefreshHint?.targetUrl, undefined);

  // Rejects javascript:, data:, file: schemes
  assert.ok(out.unsafeSchemeCount >= 4);
  assert.equal(
    out.resources.some((r) => !r.url.startsWith('http')),
    false,
  );
  assert.equal(
    out.links.some((l) => !l.href.startsWith('http')),
    false,
  );

  // Deduplicates identical image URLs
  const photoResources = out.resources.filter(
    (r) => r.url === 'https://media.example.com/assets/photo.png',
  );
  assert.equal(photoResources.length, 1);

  // Flags mismatched visible domain vs href
  const phishLink = out.links.find((l) => l.host === 'phish-target.example');
  assert.ok(phishLink);
  assert.equal(phishLink.classification, 'suspicious');
  assert.ok(phishLink.evidence && phishLink.evidence.length > 0);

  // Flags URL shortener
  const shortLink = out.links.find((l) => l.host === 'bit.ly');
  assert.ok(shortLink);
  assert.equal(shortLink.classification, 'suspicious');

  // Flags misleading download bait with redirect query
  const baitLink = out.links.find((l) => l.host === 'thirdparty.example');
  assert.ok(baitLink);
  assert.equal(baitLink.classification, 'suspicious');

  // Ordinary CDN document link stays ordinary
  const ordinaryCdn = out.links.find((l) => l.host === 'cdn.example.net');
  assert.ok(ordinaryCdn);
  assert.equal(ordinaryCdn.classification, 'ordinary');
});

test('extractStaticHtmlIntelligence does not fabricate video/mp4 or audio/mpeg for extensionless <source> without type', () => {
  const html = `
    <html><body>
      <video><source src="https://cdn.example.com/media/stream-123" /></video>
      <audio><source src="https://cdn.example.com/audio/track-99" /></audio>
    </body></html>
  `;
  const out = extractStaticHtmlIntelligence(html, 'https://portal.example/');

  const videoRes = out.resources.find((r) => r.url.includes('stream-123'));
  assert.ok(videoRes);
  assert.equal(videoRes.kind, 'video');
  assert.equal(videoRes.mimeType, undefined);

  const audioRes = out.resources.find((r) => r.url.includes('track-99'));
  assert.ok(audioRes);
  assert.equal(audioRes.kind, 'audio');
  assert.equal(audioRes.mimeType, undefined);
});

