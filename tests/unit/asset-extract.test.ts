import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extract,
  extractMpdAssetUrls,
} from '../../server/services/asset-extract.ts';
import { classifyAsset } from '../../server/services/asset-classify.ts';

const MATRIX_FIXTURE_PATH = path.resolve(process.cwd(), 'fixtures/asset-matrix.html');

test('extract parses fixtures/asset-matrix.html accurately with base href, dedupe, noscript, srcset, and drop telemetry', () => {
  const html = fs.readFileSync(MATRIX_FIXTURE_PATH, 'utf8');
  const finalUrl = new URL('https://site.ex/ignored/path.html');
  const result = extract(html, finalUrl);

  assert.equal(result.byKind.image, 9);
  assert.equal(result.byKind.vector, 4);
  assert.equal(result.byKind.video, 5);
  assert.equal(result.byKind.audio, 2);
  assert.equal(result.byKind.font, 1);
  assert.equal(result.byKind.stylesheet, 1);

  assert.equal(
    result.dropped.find((d) => d.reason === 'unresolvable')?.count,
    2,
  );
  assert.ok(
    (result.dropped.find((d) => d.reason === 'scheme')?.count ?? 0) >= 2,
  );
  assert.ok(
    (result.dropped.find((d) => d.reason === 'duplicate')?.count ?? 0) >= 2,
  );

  assert.ok(result.assets.every((asset) => asset.url.startsWith('https://')));

  const urls = new Set(result.assets.map((a) => a.url));
  // <base href="https://site.ex/sub/page.html"> + ../x.svg?v=2
  assert.ok(urls.has('https://site.ex/x.svg?v=2'));
  // Protocol-relative //cdn.ex/y.mp4?v=2 resolves to https:
  assert.ok(urls.has('https://cdn.ex/y.mp4?v=2'));
  // Hash stripped from svg use[href]
  assert.ok(urls.has('https://site.ex/sprites/icons.svg'));
  // Same filename in different folders must both remain
  assert.ok(urls.has('https://site.ex/sub/a/logo.png'));
  assert.ok(urls.has('https://site.ex/sub/b/logo.png'));
  // All 3 srcset candidates + noscript + style url() + poster + font
  assert.ok(urls.has('https://site.ex/sub/pic-400.jpg'));
  assert.ok(urls.has('https://site.ex/sub/pic-800.jpg'));
  assert.ok(urls.has('https://site.ex/sub/pic-1200.jpg'));
  assert.ok(urls.has('https://site.ex/sub/noscript-fallback.png'));
  assert.ok(urls.has('https://site.ex/sub/a.webp'));
  assert.ok(urls.has('https://site.ex/sub/poster.jpg'));
  assert.ok(urls.has('https://site.ex/fonts/matrix.woff2'));
  assert.ok(urls.has('https://site.ex/sub/audio/theme.mp3'));
  assert.ok(urls.has('https://site.ex/sub/audio/voice.ogg'));

  // Video posterUrl propagation
  const yMp4 = result.assets.find((a) => a.url === 'https://cdn.ex/y.mp4?v=2');
  assert.equal(yMp4?.posterUrl, 'https://site.ex/sub/poster.jpg');
});

test('classifyAsset never drops SVG served as text/plain or application/octet-stream to other', () => {
  assert.equal(
    classifyAsset({
      url: 'https://raw.githubusercontent.com/org/repo/main/logo.svg',
      hint: 'image',
      mime: 'text/plain; charset=utf-8',
    }),
    'vector',
  );
  assert.equal(
    classifyAsset({
      url: 'https://s3.example.com/assets/icon.svg?v=2',
      hint: 'vector',
      mime: 'application/octet-stream',
    }),
    'vector',
  );
  assert.equal(
    classifyAsset({
      url: 'https://cdn.example.com/clip.mp4',
      hint: 'video',
      mime: 'application/octet-stream',
    }),
    'video',
  );
});

test('extract discovers JSON-LD image/video entries and extracts MPD BaseURL entries', () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {"@type":"Article","image":"https://cdn.ex/article-cover.webp","video":{"@type":"VideoObject","contentUrl":"https://cdn.ex/interview.mp4"}}
        </script>
      </head>
      <body>
        <template><img data-lazy-src="https://cdn.ex/from-template.png"></template>
      </body>
    </html>
  `;
  const result = extract(html, new URL('https://site.ex/'));
  const urls = new Set(result.assets.map((a) => a.url));
  assert.ok(urls.has('https://cdn.ex/article-cover.webp'));
  assert.ok(urls.has('https://cdn.ex/interview.mp4'));
  assert.ok(urls.has('https://cdn.ex/from-template.png'));

  const mpd = `
    <MPD>
      <BaseURL>https://cdn.ex/dash/video-1080.mp4</BaseURL>
      <SegmentBase><Initialization sourceURL="init.mp4" initialization="init-seg.m4s"/></SegmentBase>
    </MPD>
  `;
  assert.deepEqual(extractMpdAssetUrls(mpd), [
    'https://cdn.ex/dash/video-1080.mp4',
    'init-seg.m4s',
  ]);
});

test('extract discovers preload as=video, application/json hydration payloads, data-video-src, microdata itemprop, and generic source tags', () => {
  const html = `
    <html>
      <head>
        <link rel="preload" as="video" href="https://cdn.ex/hero-preload.mp4" />
        <meta itemprop="image" content="https://cdn.ex/schema-thumb.jpg" />
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"cover":"https://cdn.ex/next-cover.webp","clip":"https://cdn.ex/next-clip.webm"}}}
        </script>
      </head>
      <body>
        <div data-video-src="https://cdn.ex/player-stream.mp4" data-bg-src="https://cdn.ex/player-bg.png"></div>
        <picture><source src="/media/fallback-pic.avif" /></picture>
      </body>
    </html>
  `;
  const result = extract(html, new URL('https://site.ex/'));
  const byUrl = new Map(result.assets.map((a) => [a.url, a]));
  assert.equal(byUrl.get('https://cdn.ex/hero-preload.mp4')?.kind, 'video');
  assert.equal(byUrl.get('https://cdn.ex/schema-thumb.jpg')?.kind, 'image');
  assert.equal(byUrl.get('https://cdn.ex/next-cover.webp')?.kind, 'image');
  assert.equal(byUrl.get('https://cdn.ex/next-clip.webm')?.kind, 'video');
  assert.equal(byUrl.get('https://cdn.ex/player-stream.mp4')?.kind, 'video');
  assert.equal(byUrl.get('https://cdn.ex/player-bg.png')?.kind, 'image');
  assert.equal(byUrl.get('https://site.ex/media/fallback-pic.avif')?.kind, 'image');
});
