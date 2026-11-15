import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import express from 'express';
import { createDownloadRouter } from '../../server/routes/download-route.ts';
import { createHlsRouter } from '../../server/routes/hls-route.ts';
import { createStreamRouter } from '../../server/routes/stream-route.ts';
import { InspectionStore } from '../../server/services/inspection-store.ts';
import type { DnsLookupFn } from '../../server/types/server.ts';
import { isRetryableBulkError } from '../../src/services/bulk-inspection-store.ts';
import {
  buildResilientImageCandidates,
  encodeProxyUrlClient,
  resolveInlineStreamUrl,
} from '../../src/utils/proxy-url.ts';

const publicDns: DnsLookupFn = async (hostname) => {
  if (hostname === 'internal.local') {
    return [{ address: '127.0.0.1', family: 4 }];
  }
  return [{ address: '93.184.216.34', family: 4 }];
};

test('stateless stream, HLS, and download routes succeed when InspectionStore misses cross-instance', async () => {
  const emptyStore = new InspectionStore();
  const sid = '33333333-3333-4333-8333-333333333333';
  const assetId = 'asset-99';
  const fetchedTargets: string[] = [];

  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createStreamRouter({
      store: emptyStore,
      dnsLookup: publicDns,
      fetchProxy: async (rawUrl) => {
        fetchedTargets.push(`stream:${rawUrl}`);
        return {
          finalUrl: rawUrl,
          statusCode: 200,
          headers: { 'content-type': 'image/png', 'content-length': '4' },
          body: Buffer.from('PNG!'),
        };
      },
    }),
  );
  app.use(
    '/api',
    createHlsRouter({
      store: emptyStore,
      dnsLookup: publicDns,
      openStream: async (targetUrl) => {
        fetchedTargets.push(`hls:${targetUrl}`);
        if (targetUrl.endsWith('.ts?token=abc')) {
          return {
            status: 200,
            finalUrl: targetUrl,
            headers: { 'content-type': 'video/mp2t' },
            stream: Readable.from([Buffer.from('SEG_OK')]),
            abort: () => {},
          };
        }
        return {
          status: 200,
          finalUrl: targetUrl,
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
          stream: Readable.from([Buffer.from('#EXTM3U\n#EXTINF:4,\nchunk0.ts\n')]),
          abort: () => {},
        };
      },
    }),
  );
  app.use(
    '/api',
    createDownloadRouter({
      store: emptyStore,
      dnsLookup: publicDns,
      fetchAssetHop: async (target) => {
        fetchedTargets.push(`dl:${target.normalizedUrl}`);
        return {
          kind: 'stream',
          statusCode: 200,
          contentType: 'image/png',
          contentLength: 5,
          stream: Readable.from([Buffer.from('DL_OK')]),
          abort: () => {},
        };
      },
    }),
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    // 1. Stream route succeeds with ?u= even on cold instance where store.get(sid) is null
    const imgUrl = 'https://cdn.example.com/photo.png';
    const refUrl = 'https://site.example.com/page';
    const streamRes = await fetch(
      `${base}/api/assets/stream/${sid}/${assetId}?u=${encodeProxyUrlClient(imgUrl)}&ref=${encodeProxyUrlClient(refUrl)}`,
    );
    assert.equal(streamRes.status, 200);
    assert.equal(await streamRes.text(), 'PNG!');

    // 2. Stream route STILL returns 404 when neither store nor ?u= exists, and 403 for SSRF ?u=
    const missingRes = await fetch(`${base}/api/assets/stream/${sid}/${assetId}`);
    assert.equal(missingRes.status, 404);
    const ssrfRes = await fetch(
      `${base}/api/assets/stream/${sid}/${assetId}?u=${encodeProxyUrlClient('http://internal.local/secret.png')}`,
    );
    assert.equal(ssrfRes.status, 403);

    // 3. HLS root playlist + rewritten child segment both work without InspectionStore
    const m3u8Url = 'https://media.example.com/live/master.m3u8?token=abc';
    const hlsRootRes = await fetch(
      `${base}/api/hls/${sid}/${assetId}?src=${encodeProxyUrlClient(m3u8Url)}&ref=${encodeProxyUrlClient(refUrl)}`,
    );
    assert.equal(hlsRootRes.status, 200);
    const rewrittenPlaylist = await hlsRootRes.text();
    const segLine = rewrittenPlaylist
      .split('\n')
      .find((line) => line.startsWith('/api/hls/'));
    assert.ok(segLine, 'rewritten playlist must emit child /api/hls URL');
    assert.ok(segLine.includes('&src='), 'rewritten child URL must carry stateless src metadata');

    const segRes = await fetch(`${base}${segLine}`);
    assert.equal(segRes.status, 200);
    assert.equal(await segRes.text(), 'SEG_OK');
    assert.ok(fetchedTargets.includes('hls:https://media.example.com/live/chunk0.ts?token=abc'));

    // 4. Download POST works without InspectionStore when fallback URL is supplied
    const dlRes = await fetch(`${base}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectionId: sid,
        resourceId: assetId,
        url: imgUrl,
        referer: refUrl,
        kind: 'image',
        assetKind: 'image',
        mimeType: 'image/png',
      }),
    });
    assert.equal(dlRes.status, 200);
    assert.equal(await dlRes.text(), 'DL_OK');

    // Download POST without fallback still returns 404 when session is missing
    const dlMissingRes = await fetch(`${base}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId: sid, resourceId: assetId }),
    });
    assert.equal(dlMissingRes.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('proxy-url builders attach stateless u/src and ref metadata for stream and HLS endpoints', () => {
  const sid = '44444444-4444-4444-8444-444444444444';
  const streamUrl = resolveInlineStreamUrl(
    {
      id: 'vid-1',
      url: 'https://cdn.example.com/movie.mp4',
      streamUrl: `/api/assets/stream/${sid}/vid-1`,
      assetKind: 'video',
      source: 'html-video',
      referer: 'https://site.example.com/watch',
    },
    sid,
  );
  assert.ok(streamUrl.startsWith(`/api/assets/stream/${sid}/vid-1?u=`));
  assert.ok(streamUrl.includes('&ref='));

  const hlsUrl = resolveInlineStreamUrl(
    {
      id: 'hls-1',
      url: 'https://cdn.example.com/playlist.m3u8?exp=123',
      hlsUrl: `/api/hls/${sid}/hls-1`,
      assetKind: 'hls',
      source: 'html-video',
      referer: 'https://site.example.com/watch',
    },
    sid,
  );
  assert.ok(hlsUrl.startsWith(`/api/hls/${sid}/hls-1?src=`));
  assert.ok(hlsUrl.includes('&ref='));

  const imgCandidates = buildResilientImageCandidates(
    {
      id: 'img-1',
      url: 'https://cdn.example.com/pic.jpg',
      streamUrl: `/api/assets/stream/${sid}/img-1`,
      classification: 'allowed',
      source: 'html-img',
      referer: 'https://site.example.com/gallery',
    },
    sid,
  );
  assert.ok(imgCandidates[0]?.startsWith(`/api/assets/stream/${sid}/img-1?u=`));
});

test('isRetryableBulkError retries 504 timeouts, BACKEND_UNAVAILABLE, and NETWORK_ERROR without retrying permanent rejections', () => {
  // 504 message contains "melebihi batas waktu server" — MUST retry!
  assert.equal(
    isRetryableBulkError({
      code: 'SERVER_ERROR',
      message: 'Permintaan pemeriksaan melebihi batas waktu server. Coba lagi.',
    }),
    true,
  );
  assert.equal(
    isRetryableBulkError({
      code: 'BACKEND_UNAVAILABLE',
      message: 'Layanan inspeksi server tidak merespons dengan format yang valid.',
    }),
    true,
  );
  assert.equal(
    isRetryableBulkError({
      code: 'NETWORK_ERROR',
      message: 'Tidak dapat terhubung ke layanan inspeksi.',
    }),
    true,
  );

  // Permanent rejections must NOT retry
  assert.equal(
    isRetryableBulkError({ code: 'INVALID_URL', message: 'URL tidak valid.' }),
    false,
  );
  assert.equal(
    isRetryableBulkError({
      code: 'PROHIBITED_DESTINATION',
      message: 'Dibatasi oleh kebijakan keamanan.',
    }),
    false,
  );
  assert.equal(
    isRetryableBulkError({
      code: 'SERVER_ERROR',
      message: 'Terdeteksi pengalihan berulang (redirect loop) pada tautan tujuan.',
    }),
    false,
  );
});
