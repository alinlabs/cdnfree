import test from 'node:test';
import assert from 'node:assert/strict';
import { extractStaticHtmlIntelligence } from '../../server/services/html-extractor.ts';
import { inspectUrlTarget } from '../../server/services/redirect-inspector.ts';
import type { SecondaryFetchFn } from '../../server/services/deep-asset-scanner.ts';
import type { DnsLookupFn } from '../../server/types/server.ts';
import type { FetchHopFn } from '../../server/services/safe-fetch.ts';

const publicDns: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

test('extractStaticHtmlIntelligence captures lazy attrs, meta media, inline CSS, SVG sprites, JSON-LD, inline scripts, and direct <a href> assets in bulk mode', () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="/og-cover.jpg" />
        <meta name="twitter:image" content="https://cdn.example/tw-card.png" />
        <meta property="og:video" content="https://cdn.example/promo.mp4" />
        <style>
          @font-face { src: url('/fonts/custom.woff2'); }
          .hero { background-image: url('/images/hero-bg.webp'); }
        </style>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "VideoObject",
            "thumbnailUrl": "https://cdn.example/ld-thumb.jpg",
            "contentUrl": "https://cdn.example/ld-video.webm"
          }
        </script>
      </head>
      <body>
        <img data-original="/lazy/photo-1.avif" data-lazy-src="/lazy/photo-2.png" />
        <div data-bg="/bg/banner.jpg" style="background: url('/inline/pattern.png')"></div>
        <svg><use href="/icons/sprite.svg#arrow-right"></use></svg>
        <a href="/docs/annual-report.pdf">Unduh Laporan</a>
        <a href="/api/render?id=99&format=png">Unduh PNG</a>
        <a href="/artikel/berita-hari-ini">Baca Artikel</a>
        <script>
          window.__NEXT_DATA__ = {"hero":"https:\\/\\/media.example\\/hydrated\\/shot.webp","clip":"\\/clips\\/teaser.mp4?token=abc"};
        </script>
      </body>
    </html>
  `;

  // Simulate Bulk Mode (includeStaticLinks: false, includeResources: true)
  const out = extractStaticHtmlIntelligence(html, 'https://portal.example/news/1', {
    includeStaticLinks: false,
    includeResources: true,
  });

  assert.equal(out.links.length, 0);

  const urls = new Set(out.resources.map((r) => r.url));
  assert.ok(urls.has('https://portal.example/og-cover.jpg'));
  assert.ok(urls.has('https://cdn.example/tw-card.png'));
  assert.ok(urls.has('https://cdn.example/promo.mp4'));
  assert.ok(urls.has('https://portal.example/fonts/custom.woff2'));
  assert.ok(urls.has('https://portal.example/images/hero-bg.webp'));
  assert.ok(urls.has('https://cdn.example/ld-thumb.jpg'));
  assert.ok(urls.has('https://cdn.example/ld-video.webm'));
  assert.ok(urls.has('https://portal.example/lazy/photo-1.avif'));
  assert.ok(urls.has('https://portal.example/lazy/photo-2.png'));
  assert.ok(urls.has('https://portal.example/bg/banner.jpg'));
  assert.ok(urls.has('https://portal.example/inline/pattern.png'));
  assert.ok(urls.has('https://portal.example/icons/sprite.svg'));
  assert.ok(urls.has('https://portal.example/docs/annual-report.pdf'));
  assert.ok(urls.has('https://portal.example/api/render?id=99&format=png'));
  assert.ok(urls.has('https://media.example/hydrated/shot.webp'));
  assert.ok(urls.has('https://portal.example/clips/teaser.mp4?token=abc'));

  // Regular HTML page link should NOT be classified as a resource
  assert.equal(urls.has('https://portal.example/artikel/berita-hari-ini'), false);

  const fontRes = out.resources.find((r) => r.url.endsWith('custom.woff2'));
  assert.equal(fontRes?.kind, 'font');
});

test('inspectUrlTarget secondary scanner extracts external CSS (@import + @font-face), manifest icons, nested iframe media, HLS .m3u8 tracks, and HEAD-probes extensionless assets', async () => {
  const fetchHop: FetchHopFn = async () => ({
    kind: 'document',
    statusCode: 200,
    contentType: 'text/html; charset=utf-8',
    bodyText: `
      <html>
        <head>
          <title>Situs Uji Deep Scan</title>
          <link rel="stylesheet" href="/styles/main.css" />
          <link rel="manifest" href="/app.webmanifest" />
        </head>
        <body>
          <img src="/media/extensionless-banner" />
          <video><source src="/streams/master.m3u8" type="application/vnd.apple.mpegurl" /></video>
          <iframe src="https://embed.example/player"></iframe>
        </body>
      </html>
    `,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const fetchSecondary: SecondaryFetchFn = async (url, options) => {
    if (url === 'https://site.example/styles/main.css' && options.method === 'GET') {
      const css = `
        @import "/styles/fonts.css";
        .card { background-image: url("../images/css-card.png"); }
      `;
      return {
        finalUrl: url,
        statusCode: 200,
        headers: { 'content-type': 'text/css', 'content-length': String(css.length) },
        body: Buffer.from(css, 'utf8'),
      };
    }

    if (url === 'https://site.example/styles/fonts.css' && options.method === 'GET') {
      const css = `@font-face { font-family: 'Inter'; src: url('/fonts/inter-var.woff2'); }`;
      return {
        finalUrl: url,
        statusCode: 200,
        headers: { 'content-type': 'text/css' },
        body: Buffer.from(css, 'utf8'),
      };
    }

    if (url === 'https://site.example/app.webmanifest' && options.method === 'GET') {
      const manifest = JSON.stringify({
        icons: [{ src: '/icons/pwa-512.png', type: 'image/png' }],
        screenshots: [{ src: '/screens/home.webp', type: 'image/webp' }],
      });
      return {
        finalUrl: url,
        statusCode: 200,
        headers: { 'content-type': 'application/manifest+json' },
        body: Buffer.from(manifest, 'utf8'),
      };
    }

    if (url === 'https://embed.example/player' && options.method === 'GET') {
      const frameHtml = `
        <html><body>
          <video poster="/poster-frame.jpg"><source src="/hd/movie.mp4" type="video/mp4" /></video>
        </body></html>
      `;
      return {
        finalUrl: url,
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: Buffer.from(frameHtml, 'utf8'),
      };
    }

    if (url === 'https://site.example/streams/master.m3u8' && options.method === 'GET') {
      const m3u8 = [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Indonesian",URI="/streams/audio-id.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1200000',
        '/streams/1080p.m3u8',
      ].join('\n');
      return {
        finalUrl: url,
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: Buffer.from(m3u8, 'utf8'),
      };
    }

    if (url === 'https://site.example/media/extensionless-banner' && options.method === 'HEAD') {
      return {
        finalUrl: url,
        statusCode: 200,
        headers: {
          'content-type': 'image/webp',
          'content-length': '48210',
        },
        body: Buffer.alloc(0),
      };
    }

    return {
      finalUrl: url,
      statusCode: 404,
      headers: {},
      body: Buffer.alloc(0),
    };
  };

  const result = await inspectUrlTarget('https://site.example/', {
    dnsLookup: publicDns,
    fetchHop,
    fetchSecondary,
  });

  const byUrl = new Map(result.resources.map((r) => [r.url, r]));

  // CSS + @import + @font-face
  assert.ok(byUrl.has('https://site.example/images/css-card.png'));
  assert.equal(byUrl.get('https://site.example/fonts/inter-var.woff2')?.kind, 'font');
  assert.equal(byUrl.get('https://site.example/styles/main.css')?.observation, 'fetched');

  // Web App Manifest
  assert.equal(byUrl.get('https://site.example/icons/pwa-512.png')?.kind, 'image');
  assert.equal(byUrl.get('https://site.example/screens/home.webp')?.kind, 'image');

  // Nested iframe HTML media
  assert.equal(byUrl.get('https://embed.example/hd/movie.mp4')?.kind, 'video');
  assert.equal(byUrl.get('https://embed.example/poster-frame.jpg')?.kind, 'image');

  // HLS master playlist variants & audio
  assert.ok(byUrl.has('https://site.example/streams/audio-id.m3u8'));
  assert.ok(byUrl.has('https://site.example/streams/1080p.m3u8'));

  // HEAD metadata probe on extensionless image
  const probedBanner = byUrl.get('https://site.example/media/extensionless-banner');
  assert.ok(probedBanner);
  assert.equal(probedBanner.mimeType, 'image/webp');
  assert.equal(probedBanner.declaredBytes, 48210);
  assert.equal(probedBanner.observation, 'fetched');
});

test('inspectUrlTarget secondary scanner extracts media URLs from primary same-host JS entry bundles', async () => {
  const fetchHop: FetchHopFn = async () => ({
    kind: 'document',
    statusCode: 200,
    contentType: 'text/html; charset=utf-8',
    bodyText: `
      <html>
        <head>
          <title>SPA Media App</title>
          <script type="module" src="/assets/index-abc123.js"></script>
        </head>
        <body><div id="root"></div></body>
      </html>
    `,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const fetchSecondary: SecondaryFetchFn = async (url, options) => {
    if (url === 'https://spa.example/assets/index-abc123.js' && options.method === 'GET') {
      const js = `
        const hero = "/media/spa-hero.webp";
        const teaser = "https://cdn.spa.example/videos/launch-4k.mp4";
      `;
      return {
        finalUrl: url,
        statusCode: 200,
        headers: { 'content-type': 'application/javascript' },
        body: Buffer.from(js, 'utf8'),
      };
    }
    return {
      finalUrl: url,
      statusCode: 404,
      headers: {},
      body: Buffer.alloc(0),
    };
  };

  const result = await inspectUrlTarget('https://spa.example/', {
    dnsLookup: publicDns,
    fetchHop,
    fetchSecondary,
  });

  const byUrl = new Map(result.resources.map((r) => [r.url, r]));
  assert.equal(byUrl.get('https://spa.example/media/spa-hero.webp')?.kind, 'image');
  assert.equal(byUrl.get('https://cdn.spa.example/videos/launch-4k.mp4')?.kind, 'video');
});
