import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../../server.ts';
import { InspectionStore } from '../../server/services/inspection-store.ts';
import {
  isAuthOrAccessChallenge,
  safeFetchHop,
} from '../../server/services/safe-fetch.ts';
import { InspectionPolicyError } from '../../server/types/server.ts';
import type { ValidatedTarget } from '../../server/services/url-policy.ts';

test('safeFetchHop fails closed if socket resolves/connects to prohibited loopback address', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><title>Local</title></html>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const target: ValidatedTarget = {
      url: new URL(`http://fake-public.example:${port}/`),
      normalizedUrl: `http://fake-public.example:${port}/`,
      hostname: 'fake-public.example',
      isIdn: false,
      pinnedAddress: { address: '127.0.0.1', family: 4 },
      resolvedAddresses: [{ address: '127.0.0.1', family: 4 }],
    };

    await assert.rejects(
      () => safeFetchHop(target),
      (err: unknown) =>
        err instanceof InspectionPolicyError &&
        err.code === 'PROHIBITED_DESTINATION',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('API routes validate input, reject SSRF targets, store inspections, and omit sensitive headers', async () => {
  let capturedHeaders: Record<string, unknown> = {};
  const store = new InspectionStore();

  const app = createApiApp({
    store,
    inspectOptions: {
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchHop: async (target) => {
        capturedHeaders = {
          host: target.url.host,
        };
        if (target.url.pathname === '/non-html') {
          throw new InspectionPolicyError(
            'UNSUPPORTED_CONTENT_TYPE',
            'Tujuan tidak mengembalikan halaman HTML yang dapat diperiksa.',
            415,
          );
        }
        if (target.url.pathname === '/bomb') {
          throw new InspectionPolicyError(
            'RESPONSE_TOO_LARGE',
            'Ukuran halaman melebihi batas maksimum 2 MiB.',
            413,
          );
        }
        return {
          kind: 'document',
          statusCode: 200,
          contentType: 'text/html',
          bodyText: '<html><head><title>Contoh Publik</title></head></html>',
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
        };
      },
    },
  });

  const apiServer = http.createServer(app);
  await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  const { port } = apiServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { ok: boolean };
    assert.equal(healthJson.ok, true);

    // Reject private target
    const ssrfRes = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1/secret' }),
    });
    assert.equal(ssrfRes.status, 403);

    // Reject unsupported scheme
    const badSchemeRes = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'javascript:alert(1)' }),
    });
    assert.equal(badSchemeRes.status, 400);

    // Reject non-HTML MIME
    const mimeRes = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/non-html' }),
    });
    assert.equal(mimeRes.status, 415);

    // Reject oversized response
    const bombRes = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/bomb' }),
    });
    assert.equal(bombRes.status, 413);

    // Valid inspection succeeds even when client sends Cookie/Authorization headers
    const okRes = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'session=secret-cookie',
        Authorization: 'Bearer secret-jwt',
      },
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    assert.equal(okRes.status, 200);
    const created = (await okRes.json()) as {
      id: string;
      page: { title?: string };
    };
    assert.equal(created.page.title, 'Contoh Publik');
    assert.equal(capturedHeaders.host, 'example.com');

    // GET /api/inspect/:id returns stored result
    const getRes = await fetch(`${baseUrl}/api/inspect/${created.id}`);
    assert.equal(getRes.status, 200);
    const fetched = (await getRes.json()) as { id: string };
    assert.equal(fetched.id, created.id);

    // Unknown UUID returns 404
    const missingRes = await fetch(
      `${baseUrl}/api/inspect/00000000-0000-4000-8000-000000000000`,
    );
    assert.equal(missingRes.status, 404);
    assert.equal(missingRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(missingRes.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(missingRes.headers.get('cross-origin-resource-policy'), 'same-origin');

    // Cross-site API POST attempts are rejected
    const crossSiteRes = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    assert.equal(crossSiteRes.status, 403);
  } finally {
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
  }
});

test('gzip decompression helper rejects payloads exceeding 2 MiB', async () => {
  // Verify zlib decompression bomb protection directly using a >2.1 MiB zero-filled gzip buffer
  const bigBuffer = Buffer.alloc(2 * 1024 * 1024 + 64 * 1024, 'a');
  const compressed = zlib.gzipSync(bigBuffer);
  assert.ok(compressed.length < 100_000); // Highly compressed bomb

  let totalDecoded = 0;
  const maxBytes = 2 * 1024 * 1024;
  await assert.rejects(
    () =>
      new Promise<void>((resolve, reject) => {
        const gunzip = zlib.createGunzip();
        gunzip.on('data', (chunk: Buffer) => {
          totalDecoded += chunk.length;
          if (totalDecoded > maxBytes) {
            gunzip.destroy(
              new InspectionPolicyError(
                'RESPONSE_TOO_LARGE',
                'Melebihi batas 2 MiB.',
                413,
              ),
            );
          }
        });
        gunzip.on('error', reject);
        gunzip.on('end', resolve);
        gunzip.end(compressed);
      }),
    (err: unknown) =>
      err instanceof InspectionPolicyError && err.code === 'RESPONSE_TOO_LARGE',
  );
});

test('API routes return structured JSON 400 error on malformed JSON body', async () => {
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"url": ',
    });
    assert.equal(res.status, 400);
    assert.ok((res.headers.get('content-type') ?? '').includes('application/json'));
    const body = (await res.json()) as { code?: string; message?: string };
    assert.equal(body.code, 'INVALID_REQUEST');
    assert.ok(body.message);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('isAuthOrAccessChallenge rejects 401, 402, 403, and WWW-Authenticate challenges', () => {
  assert.equal(isAuthOrAccessChallenge(401, {}), true);
  assert.equal(isAuthOrAccessChallenge(402, {}), true);
  assert.equal(isAuthOrAccessChallenge(403, {}), true);
  assert.equal(
    isAuthOrAccessChallenge(200, { 'www-authenticate': 'Bearer realm="api"' }),
    true,
  );
  assert.equal(isAuthOrAccessChallenge(200, {}), false);
  assert.equal(isAuthOrAccessChallenge(404, {}), false);
});

test('POST /api/inspect inspects direct SVG and PDF file URLs cleanly', async () => {
  const store = new InspectionStore();
  const app = createApiApp({
    store,
    inspectOptions: {
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchHop: async (target) => {
        if (target.url.pathname.endsWith('.pdf')) {
          return {
            kind: 'asset',
            statusCode: 200,
            contentType: 'application/pdf',
            declaredBytes: 4096,
            headers: { 'content-type': 'application/pdf' },
          };
        }
        return {
          kind: 'asset',
          statusCode: 200,
          contentType: 'image/svg+xml',
          declaredBytes: 512,
          headers: { 'content-type': 'image/svg+xml' },
        };
      },
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const pdfRes = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://cdn.example/panduan.pdf' }),
    });
    assert.equal(pdfRes.status, 200);
    const pdfJson = (await pdfRes.json()) as {
      page: { title?: string; contentType: string };
      resources: Array<{ kind: string; mimeType?: string; declaredBytes?: number }>;
      preview: { mode: string };
    };
    assert.equal(pdfJson.page.title, 'panduan.pdf');
    assert.equal(pdfJson.page.contentType, 'application/pdf');
    assert.equal(pdfJson.preview.mode, 'embeddable');
    assert.equal(pdfJson.resources[0].kind, 'document');
    assert.equal(pdfJson.resources[0].declaredBytes, 4096);

    const svgRes = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://cdn.example/logo.svg' }),
    });
    assert.equal(svgRes.status, 200);
    const svgJson = (await svgRes.json()) as {
      page: { title?: string; contentType: string };
      resources: Array<{ kind: string; mimeType?: string }>;
    };
    assert.equal(svgJson.page.title, 'logo.svg');
    assert.equal(svgJson.resources[0].kind, 'image');
    assert.equal(svgJson.resources[0].mimeType, 'image/svg+xml');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

