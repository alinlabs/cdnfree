import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../../server.ts';
import { InspectionStore } from '../../server/services/inspection-store.ts';
import { CapturedAssetStore } from '../../server/services/proxy/captured-store.ts';
import { rewriteHtmlDocument } from '../../server/services/proxy/rewrite.ts';
import { buildProxyShim } from '../../server/services/proxy/shim.ts';
import { encodeProxyUrl } from '../../server/services/proxy/urlcodec.ts';

test('rewriteHtmlDocument resolves relative URLs against upstream base href and /api/asset retries without Referer on 403 and rejects HTML challenge pages', async () => {
  const shim = buildProxyShim('http://127.0.0.1:3000', 'https://app.example/sub/view');
  const htmlOut = rewriteHtmlDocument(
    '<!doctype html><html><head><base href="https://cdn.example/v2/"></head><body><img src="img/banner.webp"><a href="next">Next</a></body></html>',
    'https://app.example/sub/view',
    '',
    shim,
  );
  assert.equal(htmlOut.includes('<base'), false);
  assert.ok(htmlOut.includes(encodeProxyUrl('https://cdn.example/v2/img/banner.webp')));
  assert.ok(htmlOut.includes(encodeProxyUrl('https://cdn.example/v2/next')));

  const store = new InspectionStore();
  store.set({
    id: '22222222-2222-4222-8222-222222222222',
    submittedUrl: 'https://page.example/',
    finalUrl: 'https://page.example/',
    page: {
      title: 'Test',
      statusCode: 200,
      contentType: 'text/html',
      isIdn: false,
    },
    redirects: [],
    resources: [],
    links: [],
    cdnHosts: [],
    summary: {
      inspectedAt: new Date().toISOString(),
      durationMs: 10,
      redirectCount: 0,
      resourceCount: 0,
      blockedCount: 0,
      flaggedCount: 0,
      reviewCount: 0,
      unsafeSchemeCount: 0,
      limitations: [],
    },
    preview: {
      mode: 'embeddable',
    },
  });

  const refererCalls: Array<string | undefined> = [];
  const app = createApiApp(
    { store },
    { store },
    undefined,
    {
      store,
      capturedStore: new CapturedAssetStore(),
      fetchProxy: async (rawUrl, options) => {
        if (rawUrl === 'https://hotlink.example/pic.jpg') {
          refererCalls.push(options?.headers?.Referer);
          if (options?.headers?.Referer) {
            return {
              finalUrl: rawUrl,
              statusCode: 403,
              headers: { 'content-type': 'text/plain' },
              body: Buffer.from('Forbidden hotlink'),
            };
          }
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: { 'content-type': 'image/jpeg' },
            body: Buffer.from('JPEG_OK'),
          };
        }
        return {
          finalUrl: rawUrl,
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: Buffer.from('<html><body>Challenge</body></html>'),
        };
      },
    },
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const okRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://hotlink.example/pic.jpg')}&sid=22222222-2222-4222-8222-222222222222`,
    );
    assert.equal(okRes.status, 200);
    assert.equal(await okRes.text(), 'JPEG_OK');
    assert.deepEqual(refererCalls, ['https://page.example/', undefined]);

    const htmlAsImgRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://waf.example/photo.png')}`,
    );
    assert.equal(htmlAsImgRes.status, 502);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
