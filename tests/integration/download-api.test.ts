import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../../server.ts';
import { sanitizeDownloadFilename } from '../../server/security/request-limits.ts';
import { InspectionStore } from '../../server/services/inspection-store.ts';
import { InspectionPolicyError, type ServerInspectionResult } from '../../server/types/server.ts';

function buildFixtureInspection(id: string): ServerInspectionResult {
  return {
    id,
    submittedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    page: {
      title: 'Example',
      statusCode: 200,
      contentType: 'text/html',
      isIdn: false,
    },
    redirects: [],
    resources: [
      {
        id: 'res-img-ok',
        url: 'https://cdn.example.com/photo.png',
        host: 'cdn.example.com',
        kind: 'image',
        mimeType: 'image/png',
        source: 'html-img',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'res-img-redirect-private',
        url: 'https://cdn.example.com/redirect-private.png',
        host: 'cdn.example.com',
        kind: 'image',
        mimeType: 'image/png',
        source: 'html-img',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'res-img-oversized-header',
        url: 'https://cdn.example.com/huge-header.png',
        host: 'cdn.example.com',
        kind: 'image',
        mimeType: 'image/png',
        source: 'html-img',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'res-img-oversized-stream',
        url: 'https://cdn.example.com/huge-stream.png',
        host: 'cdn.example.com',
        kind: 'image',
        mimeType: 'image/png',
        source: 'html-img',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'res-img-bad-mime',
        url: 'https://cdn.example.com/disguised.png',
        host: 'cdn.example.com',
        kind: 'image',
        mimeType: 'image/png',
        source: 'html-img',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'res-img-auth-gated',
        url: 'https://cdn.example.com/private.png',
        host: 'cdn.example.com',
        kind: 'image',
        mimeType: 'image/png',
        source: 'html-img',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'res-script-disallowed',
        url: 'https://cdn.example.com/app.js',
        host: 'cdn.example.com',
        kind: 'script',
        mimeType: 'application/javascript',
        source: 'html-script',
        observation: 'discovered',
        classification: 'allowed',
      },
      {
        id: 'res-ad-disallowed',
        url: 'https://doubleclick.net/pixel.gif',
        host: 'doubleclick.net',
        kind: 'image',
        mimeType: 'image/gif',
        source: 'html-img',
        observation: 'discovered',
        classification: 'ad-or-tracker',
      },
      {
        id: 'res-unicode-name',
        url: 'https://cdn.example.com/foto-caf%C3%A9.png',
        host: 'cdn.example.com',
        kind: 'image',
        mimeType: 'image/png',
        source: 'html-img',
        observation: 'discovered',
        classification: 'allowed',
      },
    ],
    links: [],
    cdnHosts: [],
    summary: {
      inspectedAt: '2026-11-13T12:00:00.000Z',
      durationMs: 10,
      redirectCount: 0,
      resourceCount: 8,
      blockedCount: 0,
      flaggedCount: 1,
      reviewCount: 0,
      unsafeSchemeCount: 0,
      limitations: [],
    },
    preview: { mode: 'embeddable' },
  };
}

test('sanitizeDownloadFilename strips traversal, control chars, and dangerous extensions', () => {
  const safe1 = sanitizeDownloadFilename(
    'https://cdn.example.com/../../evil%0d%0aSet-Cookie%3Ax=1.png',
    'image/png',
  );
  assert.equal(/[\r\n/\\]/.test(safe1), false);
  assert.equal(safe1.includes('..'), false);
  assert.ok(safe1.endsWith('.png'));

  const safe2 = sanitizeDownloadFilename(
    'https://cdn.example.com/payload.exe',
    'image/jpeg',
  );
  assert.equal(safe2, 'payload.jpg');
});

test('POST /api/assets/download validates store binding, SSRF redirects, MIME, auth, and byte caps', async () => {
  const store = new InspectionStore();
  const inspectionId = '11111111-1111-4111-8111-111111111111';
  store.set(buildFixtureInspection(inspectionId));

  const app = createApiApp(
    { store },
    {
      store,
      maxBytes: 1024,
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchAssetHop: async (target) => {
        const pathname = target.url.pathname;

        if (pathname === '/photo.png' || pathname === '/foto-caf%C3%A9.png') {
          const payload = Buffer.from('PNG_FIXTURE_BYTES');
          return {
            kind: 'stream',
            statusCode: 200,
            contentType: 'image/png',
            contentLength: payload.length,
            stream: Readable.from([payload]),
            abort: () => {},
          };
        }

        if (pathname === '/redirect-private.png') {
          return {
            kind: 'redirect',
            statusCode: 302,
            location: 'http://127.0.0.1/secret.png',
          };
        }

        if (pathname === '/huge-header.png') {
          throw new InspectionPolicyError(
            'RESPONSE_TOO_LARGE',
            'Aset tidak dapat diunduh karena ukurannya melebihi batas maksimum server.',
            413,
          );
        }

        if (pathname === '/huge-stream.png') {
          const bigChunk = Buffer.alloc(2048, 0x41);
          return {
            kind: 'stream',
            statusCode: 200,
            contentType: 'image/png',
            stream: Readable.from([bigChunk]),
            abort: () => {},
          };
        }

        if (pathname === '/disguised.png') {
          return {
            kind: 'stream',
            statusCode: 200,
            contentType: 'text/html',
            stream: Readable.from([Buffer.from('<script>alert(1)</script>')]),
            abort: () => {},
          };
        }

        if (pathname === '/private.png') {
          throw new InspectionPolicyError(
            'PROHIBITED_DESTINATION',
            'Aset tidak dapat diunduh karena memerlukan autentikasi, otorisasi, atau tidak tersedia secara publik.',
            403,
          );
        }

        throw new InspectionPolicyError('UPSTREAM_ERROR', 'Not mocked', 502);
      },
    },
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Safe public asset succeeds with sanitized headers
    const okRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId, resourceId: 'res-img-ok' }),
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(
      okRes.headers.get('content-security-policy'),
      "sandbox; default-src 'none'",
    );
    assert.ok((okRes.headers.get('content-disposition') ?? '').includes('photo.png'));
    assert.equal(await okRes.text(), 'PNG_FIXTURE_BYTES');

    // 2. Unbound/missing inspection ID rejected
    const missingInspection = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectionId: '22222222-2222-4222-8222-222222222222',
        resourceId: 'res-img-ok',
      }),
    });
    assert.equal(missingInspection.status, 404);

    // 3. Disallowed script / ad-tracker rejected
    const scriptRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId, resourceId: 'res-script-disallowed' }),
    });
    assert.equal(scriptRes.status, 403);

    const adRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId, resourceId: 'res-ad-disallowed' }),
    });
    assert.equal(adRes.status, 403);

    // 4. Redirect to private IP rejected
    const redirectRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectionId,
        resourceId: 'res-img-redirect-private',
      }),
    });
    assert.equal(redirectRes.status, 403);

    // 5. Oversized header & oversized chunked stream rejected
    const hugeHeaderRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectionId,
        resourceId: 'res-img-oversized-header',
      }),
    });
    assert.equal(hugeHeaderRes.status, 413);

    const hugeStreamRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectionId,
        resourceId: 'res-img-oversized-stream',
      }),
    });
    assert.equal(hugeStreamRes.status, 413);

    // 6. Dangerous MIME rejected
    const badMimeRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId, resourceId: 'res-img-bad-mime' }),
    });
    assert.equal(badMimeRes.status, 415);

    // 7. Auth-gated / paywalled asset rejected
    const authRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId, resourceId: 'res-img-auth-gated' }),
    });
    assert.equal(authRes.status, 403);

    // 8. Cross-site download trigger rejected
    const csrfDownloadRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ inspectionId, resourceId: 'res-img-ok' }),
    });
    assert.equal(csrfDownloadRes.status, 403);

    // 9. Resource ID from a different inspection session cannot be substituted
    const otherInspectionId = '33333333-3333-4333-8333-333333333333';
    store.set({
      ...buildFixtureInspection(otherInspectionId),
      resources: [
        {
          id: 'res-other-site',
          url: 'https://other.example.com/banner.png',
          host: 'other.example.com',
          kind: 'image',
          mimeType: 'image/png',
          source: 'html-img',
          observation: 'discovered',
          classification: 'allowed',
        },
      ],
    });
    const substitutedRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectionId,
        resourceId: 'res-other-site',
      }),
    });
    assert.equal(substitutedRes.status, 404);

    // 10. Non-ASCII filename succeeds with ASCII fallback + RFC 5987 filename*
    const unicodeRes = await fetch(`${baseUrl}/api/assets/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectionId,
        resourceId: 'res-unicode-name',
      }),
    });
    assert.equal(unicodeRes.status, 200);
    const cdHeader = unicodeRes.headers.get('content-disposition') ?? '';
    assert.ok(cdHeader.includes('filename="foto-caf_.png"'));
    assert.ok(cdHeader.includes("filename*=UTF-8''foto-caf%C3%A9.png"));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
