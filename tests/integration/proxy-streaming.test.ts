import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { createApiApp, shouldCompressResponse } from '../../server.ts';
import { PROXY_LIMITS, SlidingWindowRateLimiter } from '../../server/security/request-limits.ts';
import { InspectionStore } from '../../server/services/inspection-store.ts';
import { CapturedAssetStore } from '../../server/services/proxy/captured-store.ts';
import { parseSingleRange } from '../../server/services/proxy/stream-response.ts';
import { encodeProxyUrl } from '../../server/services/proxy/urlcodec.ts';

function createSizedStream(totalBytes: number, chunkSize = 1024 * 1024): Readable {
  let remaining = totalBytes;
  const templateChunk = Buffer.alloc(chunkSize, 0x41);
  return new Readable({
    read() {
      if (remaining <= 0) {
        this.push(null);
        return;
      }
      const nextLen = Math.min(remaining, chunkSize);
      remaining -= nextLen;
      this.push(nextLen === chunkSize ? templateChunk : templateChunk.subarray(0, nextLen));
    },
  });
}

test('parseSingleRange parses valid single byte ranges and rejects multi-range', () => {
  assert.deepEqual(parseSingleRange('bytes=0-1023', 4096), {
    ok: true,
    start: 0,
    end: 1023,
  });
  assert.deepEqual(parseSingleRange('bytes=100-', 500), {
    ok: true,
    start: 100,
    end: 499,
  });
  assert.deepEqual(parseSingleRange('bytes=-128', 500), {
    ok: true,
    start: 372,
    end: 499,
  });
  assert.equal(parseSingleRange('bytes=0-1,5-6', 1000).ok, false);
  assert.equal(parseSingleRange('bytes=600-700', 500).ok, false);
});

test('PROXY_LIMITS sets 8 MiB html, 1 MiB text, and Infinity media', () => {
  assert.equal(PROXY_LIMITS.html, 8 * 1024 * 1024);
  assert.equal(PROXY_LIMITS.text, 1 * 1024 * 1024);
  assert.equal(PROXY_LIMITS.media, Infinity);
});

test('shouldCompressResponse skips video/*, audio/*, image/*, HEAD, 206, and Range requests', () => {
  const mkRes = (ct: string, statusCode = 200) =>
    ({
      statusCode,
      getHeader: (name: string) =>
        name.toLowerCase() === 'content-type' ? ct : undefined,
    }) as unknown as Parameters<typeof shouldCompressResponse>[1];

  const getReq = { method: 'GET', headers: {} } as Parameters<typeof shouldCompressResponse>[0];
  const rangeReq = {
    method: 'GET',
    headers: { range: 'bytes=0-10' },
  } as Parameters<typeof shouldCompressResponse>[0];

  assert.equal(shouldCompressResponse(getReq, mkRes('video/mp4')), false);
  assert.equal(shouldCompressResponse(getReq, mkRes('audio/mpeg')), false);
  assert.equal(shouldCompressResponse(getReq, mkRes('image/webp')), false);
  assert.equal(shouldCompressResponse(getReq, mkRes('text/html', 206)), false);
  assert.equal(shouldCompressResponse(rangeReq, mkRes('application/octet-stream')), false);
});

test('/api/asset forwards Range -> 206 with matching content-length, omits identity content-encoding, supports HEAD without body, slices lazy 200, and streams >300 MiB without 25 MiB truncation', async () => {
  const store = new InspectionStore();
  const capturedStore = new CapturedAssetStore();
  const BIG_SIZE = 300 * 1024 * 1024; // 300 MiB
  const SAMPLE_VIDEO = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  let headSawBodyRead = false;

  const app = createApiApp(
    { store },
    { store },
    undefined,
    {
      store,
      capturedStore,
      proxyRateLimiter: new SlidingWindowRateLimiter(60_000, 100),
      assetRateLimiter: new SlidingWindowRateLimiter(60_000, 300),
      fetchProxy: async (rawUrl, options) => {
        if (rawUrl === 'https://cdn.example/range-ok.mp4') {
          if (options?.method === 'HEAD') {
            headSawBodyRead = false;
            return {
              finalUrl: rawUrl,
              statusCode: options.range ? 206 : 200,
              headers: {
                'content-type': 'video/mp4',
                'accept-ranges': 'bytes',
                ...(options.range
                  ? {
                      'content-range': `bytes 0-1/${SAMPLE_VIDEO.length}`,
                      'content-length': '2',
                    }
                  : { 'content-length': String(SAMPLE_VIDEO.length) }),
              },
              body: Buffer.alloc(0),
            };
          }

          if (options?.range === 'bytes=0-9') {
            const slice = SAMPLE_VIDEO.subarray(0, 10);
            return {
              finalUrl: rawUrl,
              statusCode: 206,
              headers: {
                'content-type': 'video/mp4',
                'accept-ranges': 'bytes',
                'content-range': `bytes 0-9/${SAMPLE_VIDEO.length}`,
                'content-length': String(slice.length),
                'content-encoding': 'identity',
              },
              stream: Readable.from(slice),
            };
          }

          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: {
              'content-type': 'video/mp4',
              'accept-ranges': 'bytes',
              'content-length': String(SAMPLE_VIDEO.length),
            },
            stream: Readable.from(SAMPLE_VIDEO),
          };
        }

        if (rawUrl === 'https://cdn.example/lazy-cdn-200.mp4') {
          // Upstream ignores Range header and returns full 200
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: {
              'content-type': 'video/mp4',
              'content-length': String(SAMPLE_VIDEO.length),
            },
            stream: Readable.from(SAMPLE_VIDEO),
          };
        }

        if (rawUrl === 'https://cdn.example/big-300mb.mp4') {
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: {
              'content-type': 'video/mp4',
              'accept-ranges': 'bytes',
              'content-length': String(BIG_SIZE),
            },
            stream: createSizedStream(BIG_SIZE),
          };
        }

        throw new Error(`Unexpected URL: ${rawUrl}`);
      },
    },
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Meneruskan Range dan membalas 206 dengan content-range & content-length cocok
    const rangeRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://cdn.example/range-ok.mp4')}`,
      { headers: { Range: 'bytes=0-9' } },
    );
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-range'), `bytes 0-9/${SAMPLE_VIDEO.length}`);
    assert.equal(rangeRes.headers.get('content-length'), '10');
    assert.equal(rangeRes.headers.get('accept-ranges'), 'bytes');
    // 2. Tidak mengirim content-encoding: identity
    assert.equal(rangeRes.headers.get('content-encoding'), null);
    const rangeBody = Buffer.from(await rangeRes.arrayBuffer());
    assert.equal(rangeBody.length, 10);
    assert.equal(rangeBody.toString('utf8'), '0123456789');

    // 3. HEAD tidak mengunduh body
    const headRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://cdn.example/range-ok.mp4')}&probe=1`,
      { method: 'HEAD', headers: { Range: 'bytes=0-1' } },
    );
    assert.equal(headRes.status, 206);
    assert.equal(headRes.headers.get('content-range'), `bytes 0-1/${SAMPLE_VIDEO.length}`);
    assert.equal(headRes.headers.get('content-type'), 'video/mp4');
    assert.equal(headSawBodyRead, false);
    const headBuf = await headRes.arrayBuffer();
    assert.equal(headBuf.byteLength, 0);

    // 4. Upstream 200 saat klien kirim single Range -> dipotong menjadi 206
    const slicedRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://cdn.example/lazy-cdn-200.mp4')}`,
      { headers: { Range: 'bytes=10-15' } },
    );
    assert.equal(slicedRes.status, 206);
    assert.equal(slicedRes.headers.get('content-range'), `bytes 10-15/${SAMPLE_VIDEO.length}`);
    assert.equal(slicedRes.headers.get('content-length'), '6');
    assert.equal(await slicedRes.text(), 'ABCDEF');

    // 4b. Multi-range jatuh ke 200 penuh
    const multiRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://cdn.example/lazy-cdn-200.mp4')}`,
      { headers: { Range: 'bytes=0-1,5-6' } },
    );
    assert.equal(multiRes.status, 200);
    assert.equal(await multiRes.text(), SAMPLE_VIDEO.toString('utf8'));

    // 5. Asset 300 MiB tidak terpotong di 25 MiB
    const bigRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://cdn.example/big-300mb.mp4')}`,
    );
    assert.equal(bigRes.status, 200);
    assert.equal(bigRes.headers.get('content-length'), String(BIG_SIZE));
    assert.equal(bigRes.headers.get('content-encoding'), null);

    let receivedBytes = 0;
    const reader = bigRes.body?.getReader();
    assert.ok(reader);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
    }
    assert.equal(receivedBytes, BIG_SIZE);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
