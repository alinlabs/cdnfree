import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtractedAsset } from '../../server/services/asset-extract.ts';
import {
  parseContentRangeTotal,
  probeAssets,
} from '../../server/services/asset-probe.ts';

function makeExtracted(overrides: Partial<ExtractedAsset>): ExtractedAsset {
  return {
    id: 'asset1234',
    url: 'https://cdn.example.com/item.bin',
    host: 'cdn.example.com',
    kind: 'other',
    hint: 'other',
    tag: 'img',
    attr: 'src',
    probe: null,
    ...overrides,
  };
}

test('parseContentRangeTotal extracts total size and handles unknown * totals safely', () => {
  assert.equal(parseContentRangeTotal('bytes 0-1023/5242880'), 5242880);
  assert.equal(parseContentRangeTotal('bytes 0-0/*'), undefined);
  assert.equal(parseContentRangeTotal(undefined), undefined);
});

test('probeAssets enriches verified 200 and 206 Range responses and never drops 403/401 assets', async () => {
  const assets: ExtractedAsset[] = [
    makeExtracted({
      id: 'ok200',
      url: 'https://cdn.example.com/photo.jpg',
      kind: 'image',
      hint: 'image',
    }),
    makeExtracted({
      id: 'ok206',
      url: 'https://cdn.example.com/movie.mp4',
      kind: 'video',
      hint: 'video',
    }),
    makeExtracted({
      id: 'deny403',
      url: 'https://cdn.example.com/protected.mp4',
      kind: 'video',
      hint: 'video',
    }),
    makeExtracted({
      id: 'auth401',
      url: 'https://cdn.example.com/private.png',
      kind: 'image',
      hint: 'image',
    }),
    makeExtracted({
      id: 'svgplain',
      url: 'https://raw.githubusercontent.com/org/repo/logo.svg',
      kind: 'vector',
      hint: 'vector',
    }),
  ];

  const results = await probeAssets(assets, {
    pageUrl: 'https://example.com/',
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchRange: async (url) => {
      if (url.endsWith('photo.jpg')) {
        return {
          statusCode: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': '128000',
          },
        };
      }
      if (url.endsWith('movie.mp4')) {
        return {
          statusCode: 206,
          headers: {
            'content-type': 'video/mp4',
            'accept-ranges': 'bytes',
            'content-range': 'bytes 0-1023/5242880',
            'content-length': '1024',
          },
        };
      }
      if (url.endsWith('protected.mp4')) {
        return {
          statusCode: 403,
          headers: { 'content-type': 'text/html' },
        };
      }
      if (url.endsWith('private.png')) {
        return {
          statusCode: 200,
          headers: { 'www-authenticate': 'Bearer realm="cdn"' },
        };
      }
      return {
        statusCode: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'content-length': '2048',
        },
      };
    },
  });

  // Zero assets removed
  assert.equal(results.length, 5);

  assert.equal(results[0].probe?.status, 'verified');
  assert.equal(results[0].bytes, 128000);
  assert.equal(results[0].mime, 'image/jpeg');

  assert.equal(results[1].probe?.status, 'verified');
  assert.equal(results[1].bytes, 5242880);
  assert.equal(results[1].probe?.ranges, true);

  assert.equal(results[2].probe?.status, 'unverified');
  assert.equal(results[2].probe?.reason, 'http-403');
  assert.equal(results[2].probe?.httpStatus, 403);

  assert.equal(results[3].probe?.status, 'unverified');
  assert.equal(results[3].probe?.reason, 'http-403');

  // SVG served as text/plain stays vector
  assert.equal(results[4].probe?.status, 'verified');
  assert.equal(results[4].kind, 'vector');
  assert.equal(results[4].bytes, 2048);
});

test('probeAssets marks timed-out probes as unverified without discarding assets', async () => {
  const assets: ExtractedAsset[] = [
    makeExtracted({ id: 'slow1', url: 'https://cdn.example.com/slow1.png', kind: 'image' }),
    makeExtracted({ id: 'slow2', url: 'https://cdn.example.com/slow2.png', kind: 'image' }),
  ];

  const results = await probeAssets(assets, {
    pageUrl: 'https://example.com/',
    totalBudgetMs: 40,
    perProbeTimeoutMs: 40,
    concurrency: 1,
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchRange: async (_url, opts) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => resolve({ statusCode: 200, headers: { 'content-type': 'image/png' } }),
          500,
        );
        opts.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true },
        );
      }),
  });

  assert.equal(results.length, 2);
  for (const item of results) {
    assert.equal(item.probe?.status, 'unverified');
    assert.equal(item.probe?.reason, 'timeout');
  }
});
