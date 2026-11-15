import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../../server.ts';
import { InspectionStore } from '../../server/services/inspection-store.ts';
import type { InspectionResult } from '../../src/types/inspection.ts';

function makeInspectionFixture(id: string): InspectionResult {
  return {
    id,
    submittedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    page: {
      title: 'Test Page',
      statusCode: 200,
      contentType: 'text/html',
      isIdn: false,
    },
    redirects: [],
    resources: [
      {
        id: 'vid1234567890ab',
        url: 'https://cdn.example/video.mp4',
        host: 'cdn.example',
        kind: 'video',
        assetKind: 'video',
        mimeType: 'video/mp4',
        source: 'html-video',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'svg1234567890ab',
        url: 'https://raw.githubusercontent.com/org/repo/main/icon.svg',
        host: 'raw.githubusercontent.com',
        kind: 'image',
        assetKind: 'vector',
        mimeType: 'text/plain',
        source: 'html-img',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'bigvid1234567890',
        url: 'https://cdn.example/large-204mb.mp4',
        host: 'cdn.example',
        kind: 'video',
        assetKind: 'video',
        mimeType: 'video/mp4',
        declaredBytes: 214_000_000,
        source: 'html-source',
        observation: 'fetched',
        classification: 'allowed',
      },
    ],
    links: [],
    cdnHosts: [],
    summary: {
      inspectedAt: new Date().toISOString(),
      durationMs: 10,
      redirectCount: 0,
      resourceCount: 2,
      blockedCount: 0,
      flaggedCount: 0,
      reviewCount: 0,
      unsafeSchemeCount: 0,
      limitations: [],
    },
    preview: {
      mode: 'embeddable',
    },
  };
}

test('GET /api/assets/stream serves 206 Range inline without attachment, normalizes SVG text/plain with CSP, and enforces SSRF DNS checks', async () => {
  const store = new InspectionStore();
  const inspectionId = '11111111-1111-4111-8111-111111111111';
  store.set(makeInspectionFixture(inspectionId));

  const sampleVideo = Buffer.from('0123456789ABCDEFGHIJ');
  let simulatePrivateDns = false;

  const app = createApiApp(
    { store },
    { store },
    undefined,
    undefined,
    {
      store,
      dnsLookup: async () =>
        simulatePrivateDns
          ? [{ address: '10.0.0.5', family: 4 }]
          : [{ address: '93.184.216.34', family: 4 }],
      fetchProxy: async (rawUrl, options) => {
        if (rawUrl.endsWith('large-204mb.mp4')) {
          const slice = sampleVideo.subarray(0, 5);
          return {
            finalUrl: rawUrl,
            statusCode: 206,
            headers: {
              'content-type': 'application/octet-stream',
              'accept-ranges': 'bytes',
              'content-range': 'bytes 0-4/214000000',
              'content-length': String(slice.length),
            },
            stream: Readable.from(slice),
          };
        }

        if (rawUrl.endsWith('video.mp4')) {
          if (options?.range === 'bytes=0-4') {
            const slice = sampleVideo.subarray(0, 5);
            return {
              finalUrl: rawUrl,
              statusCode: 206,
              headers: {
                'content-type': 'video/mp4',
                'accept-ranges': 'bytes',
                'content-range': `bytes 0-4/${sampleVideo.length}`,
                'content-length': String(slice.length),
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
              'content-length': String(sampleVideo.length),
            },
            stream: Readable.from(sampleVideo),
          };
        }

        return {
          finalUrl: rawUrl,
          statusCode: 200,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
          },
          body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="10" cy="10" r="8"/></svg>'),
        };
      },
    },
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Video Range request -> 206 inline (NO Content-Disposition: attachment)
    const videoRes = await fetch(
      `${baseUrl}/api/assets/stream/${inspectionId}/vid1234567890ab`,
      { headers: { Range: 'bytes=0-4' } },
    );
    assert.equal(videoRes.status, 206);
    assert.equal(videoRes.headers.get('content-range'), `bytes 0-4/${sampleVideo.length}`);
    assert.equal(videoRes.headers.get('content-disposition'), null);
    assert.equal(videoRes.headers.get('cache-control'), 'private, max-age=300');
    assert.equal(videoRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(videoRes.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(await videoRes.text(), '01234');

    // 2. .svg served upstream as text/plain -> normalized to image/svg+xml + strict CSP
    const svgRes = await fetch(
      `${baseUrl}/api/assets/stream/${inspectionId}/svg1234567890ab`,
    );
    assert.equal(svgRes.status, 200);
    assert.equal(svgRes.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.equal(
      svgRes.headers.get('content-security-policy'),
      "default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'",
    );
    assert.equal(svgRes.headers.get('content-disposition'), null);
    const svgBody = await svgRes.text();
    assert.ok(svgBody.includes('<circle'));
    assert.ok(!svgBody.includes('<script'));

    // 3. Large >40 MiB video Range request -> 206 inline + normalized video/mp4 MIME (NOT 413)
    const largeVideoRes = await fetch(
      `${baseUrl}/api/assets/stream/${inspectionId}/bigvid1234567890`,
      { headers: { Range: 'bytes=0-4' } },
    );
    assert.equal(largeVideoRes.status, 206);
    assert.equal(largeVideoRes.headers.get('content-type'), 'video/mp4');
    assert.equal(largeVideoRes.headers.get('content-range'), 'bytes 0-4/214000000');
    assert.equal(await largeVideoRes.text(), '01234');

    // 4. SSRF protection when DNS resolves to private IP 10.0.0.5 -> 403
    simulatePrivateDns = true;
    const ssrfRes = await fetch(
      `${baseUrl}/api/assets/stream/${inspectionId}/vid1234567890ab`,
    );
    assert.equal(ssrfRes.status, 403);
    const errJson = (await ssrfRes.json()) as { code?: string };
    assert.equal(errJson.code, 'PROHIBITED_DESTINATION');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
