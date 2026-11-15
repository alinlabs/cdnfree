import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import express from 'express';
import { createApiApp } from '../../server.ts';
import { createHlsRouter } from '../../server/routes/hls-route.ts';
import { InspectionStore } from '../../server/services/inspection-store.ts';
import { evaluateVideoPreview } from '../../src/utils/asset-preview-policy.ts';
import { getAssetDownloadEligibility } from '../../src/utils/safe-external-url.ts';
import type { DnsLookupFn, ServerInspectionResult } from '../../server/types/server.ts';

const publicDns: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

function makeHlsInspection(id: string): ServerInspectionResult {
  return {
    id,
    submittedUrl: 'https://player.example.com/watch/1',
    finalUrl: 'https://player.example.com/watch/1',
    page: {
      title: 'HLS Demo',
      statusCode: 200,
      contentType: 'text/html',
      isIdn: false,
    },
    redirects: [],
    resources: [
      {
        id: 'hls-1',
        url: 'https://cdn.example.com/hls/master.m3u8?token=old',
        host: 'cdn.example.com',
        kind: 'video',
        assetKind: 'hls',
        mimeType: 'application/vnd.apple.mpegurl',
        hlsUrl: `/api/hls/${id}/hls-1`,
        referer: 'https://player.example.com/watch/1',
        probe: { status: 'verified', reason: 'ok', httpStatus: 200 },
        source: 'browser-observed',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'wrap-1',
        url: 'https://cdn.example.com/fake.mp4',
        host: 'cdn.example.com',
        kind: 'video',
        assetKind: 'wrapper',
        mimeType: 'text/html',
        probe: { status: 'unverified', reason: 'html-wrapper', httpStatus: 200 },
        source: 'html-video',
        observation: 'fetched',
        classification: 'allowed',
      },
    ],
    links: [],
    cdnHosts: [],
    summary: {
      inspectedAt: '2026-11-15T12:00:00.000Z',
      durationMs: 12,
      redirectCount: 0,
      resourceCount: 2,
      blockedCount: 0,
      flaggedCount: 0,
      reviewCount: 0,
      unsafeSchemeCount: 0,
      limitations: [],
    },
    preview: { mode: 'embeddable' },
  };
}

test('GET /api/hls/:sid/:assetId rewrites playlist, inherits token, re-mints on 403, and blocks SSRF child URLs', async () => {
  const store = new InspectionStore();
  const sid = '11111111-1111-4111-8111-111111111111';
  store.set(makeHlsInspection(sid));

  let reMinted = false;
  const fetchedUrls: string[] = [];

  const app = express();
  app.use(
    '/api',
    createHlsRouter({
      store,
      dnsLookup: async (hostname) => {
        if (hostname === 'internal.local') {
          return [{ address: '127.0.0.1', family: 4 }];
        }
        return publicDns(hostname);
      },
      reMint: async (s, id, aid) => {
        reMinted = true;
        const freshUrl = 'https://cdn.example.com/hls/master.m3u8?token=fresh';
        const item = s.get(id)?.resources.find((r) => r.id === aid);
        if (item) item.url = freshUrl;
        return { ok: true, url: freshUrl };
      },
      openStream: async (targetUrl) => {
        fetchedUrls.push(targetUrl);
        if (targetUrl.includes('token=old')) {
          return {
            status: 403,
            finalUrl: targetUrl,
            headers: { 'content-type': 'text/plain' },
            stream: Readable.from([]),
            abort: () => {},
          };
        }
        if (targetUrl.endsWith('.ts?token=fresh')) {
          return {
            status: 200,
            finalUrl: targetUrl,
            headers: { 'content-type': 'video/mp2t', 'accept-ranges': 'bytes' },
            stream: Readable.from([Buffer.from('TS_PACKET_BYTES')]),
            abort: () => {},
          };
        }
        return {
          status: 200,
          finalUrl: targetUrl,
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
          stream: Readable.from([Buffer.from('#EXTM3U\n#EXTINF:4,\nseg0.ts\n')]),
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

    // 1. Root playlist hits 403 with old token -> re-mints once -> returns rewritten playlist
    const rootRes = await fetch(`${base}/api/hls/${sid}/hls-1`);
    assert.equal(rootRes.status, 200);
    assert.equal(reMinted, true);
    const body = await rootRes.text();
    const segMatch = new RegExp(`/api/hls/${sid}/hls-1\\?u=([^\\s]+)`).exec(body);
    assert.ok(segMatch?.[1], 'rewritten segment URI must appear in playlist');

    // 2. Child segment request carries inherited ?token=fresh
    const segRes = await fetch(`${base}${segMatch[0]}`);
    assert.equal(segRes.status, 200);
    assert.equal(await segRes.text(), 'TS_PACKET_BYTES');
    assert.ok(fetchedUrls.includes('https://cdn.example.com/hls/seg0.ts?token=fresh'));

    // 3. SSRF child URL pointing to private IP must be rejected with 403
    const privateU = Buffer.from('http://internal.local/secret.ts', 'utf8').toString('base64url');
    const ssrfRes = await fetch(`${base}/api/hls/${sid}/hls-1?u=${privateU}`);
    assert.equal(ssrfRes.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('POST /api/assets/download and UI policy reject HTML wrapper resources and allow HLS', async () => {
  const store = new InspectionStore();
  const sid = '22222222-2222-4222-8222-222222222222';
  const insp = makeHlsInspection(sid);
  store.set(insp);

  assert.equal(evaluateVideoPreview(insp.resources[0], 'https:').status, 'hls-stream');
  assert.equal(evaluateVideoPreview(insp.resources[1], 'https:').status, 'restricted');
  assert.equal(getAssetDownloadEligibility(insp.resources[0]).eligible, true);
  assert.equal(getAssetDownloadEligibility(insp.resources[1]).eligible, false);

  const app = createApiApp({ store }, { store, dnsLookup: publicDns });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId: sid, resourceId: 'wrap-1' }),
    });
    assert.equal(res.status, 415);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
