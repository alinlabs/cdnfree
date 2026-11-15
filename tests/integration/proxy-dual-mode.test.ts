import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../../server.ts';
import { SlidingWindowRateLimiter } from '../../server/security/request-limits.ts';
import { InspectionStore } from '../../server/services/inspection-store.ts';
import { CapturedAssetStore } from '../../server/services/proxy/captured-store.ts';
import { SessionCookieJarStore } from '../../server/services/proxy/cookie-jar.ts';
import { rewriteHtmlDocument } from '../../server/services/proxy/rewrite.ts';
import { buildProxyShim } from '../../server/services/proxy/shim.ts';
import { encodeProxyUrl } from '../../server/services/proxy/urlcodec.ts';

test('rewriteHtmlDocument omits Mode Ringan shim when mode is engine', () => {
  const html = '<!doctype html><html><head></head><body><a href="/p">go</a></body></html>';
  const shim = buildProxyShim('http://127.0.0.1:3000', 'https://spa.example/', 'sess-engine');

  const engineOut = rewriteHtmlDocument(html, 'https://spa.example/', '', shim, 'sess-engine', {
    mode: 'engine',
  });
  assert.equal(engineOut.includes('cdnfree:ready'), false);

  const lightOut = rewriteHtmlDocument(html, 'https://spa.example/', '', shim, 'sess-engine', {
    mode: 'light',
  });
  assert.ok(lightOut.includes('cdnfree:ready'));
});

test('/p/* Engine static mounts, SW header, and COOP/COEP credentialless headers are served properly', async () => {
  const app = createApiApp();
  app.get('/search/web', (_req, res) => {
    res.status(200).send('<!doctype html><html><body>search</body></html>');
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const searchRes = await fetch(`${baseUrl}/search/web`);
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(searchRes.headers.get('cross-origin-embedder-policy'), 'credentialless');

    const swRes = await fetch(`${baseUrl}/p/sw.js`);
    assert.equal(swRes.status, 200);
    assert.equal(swRes.headers.get('service-worker-allowed'), '/p/');
    assert.equal(swRes.headers.get('cross-origin-embedder-policy'), 'credentialless');
    const swText = await swRes.text();
    assert.ok(swText.includes('/p/controller/controller.sw.js'));

    const mounts = [
      '/p/index.html',
      '/p/scram/scramjet.js',
      '/p/controller/controller.api.js',
      '/p/utils/scramjet-utils.js',
      '/p/libcurl/index.mjs',
    ];
    for (const mount of mounts) {
      const res = await fetch(`${baseUrl}${mount}`);
      assert.equal(res.status, 200, `Expected 200 for ${mount}`);
      await res.body?.cancel();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('GET /api/proxy?debug=1, POST session cookie jar, and Sec-Fetch-Dest script guard work end-to-end', async () => {
  const store = new InspectionStore();
  const capturedStore = new CapturedAssetStore();
  const cookieJar = new SessionCookieJarStore();
  const sid = '22222222-2222-4222-8222-222222222222';
  let lastSeenCookie: string | undefined;
  let lastPostBody: string | undefined;
  let lastForwardedCsrf: string | undefined;
  let lastForwardedOrigin: string | undefined;

  const app = createApiApp(
    { store },
    { store },
    undefined,
    {
      store,
      capturedStore,
      cookieJar,
      proxyRateLimiter: new SlidingWindowRateLimiter(60_000, 60),
      assetRateLimiter: new SlidingWindowRateLimiter(60_000, 200),
      fetchProxy: async (rawUrl, options) => {
        if (options?.cookieJar && options.sid) {
          lastSeenCookie = options.cookieJar.getCookieHeader(options.sid, rawUrl);
        }
        if (rawUrl === 'https://auth.example/login' && options?.method === 'POST') {
          lastPostBody = options.body?.toString('utf8');
          lastForwardedCsrf = options.headers?.['X-CSRF-Token'];
          lastForwardedOrigin = options.headers?.Origin;
          options.cookieJar?.storeFromHeaders(options.sid, rawUrl, [
            'auth_token=tok123; Domain=auth.example; Path=/; HttpOnly; Secure; SameSite=None',
          ]);
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'set-cookie': [
                'auth_token=tok123; Domain=auth.example; Path=/; HttpOnly; Secure; SameSite=None',
              ],
            },
            body: Buffer.from('<html><body>Logged in</body></html>', 'utf8'),
          };
        }
        if (rawUrl === 'https://cf.example/challenge') {
          return {
            finalUrl: rawUrl,
            statusCode: 403,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cf-mitigated': 'challenge',
            },
            body: Buffer.from(
              '<html><body>Just a moment... <a href="/ok">continue</a><img src="/logo.png"></body></html>',
              'utf8',
            ),
          };
        }
        if (rawUrl === 'https://auth.example/me') {
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: Buffer.from('<html><body>Profile</body></html>', 'utf8'),
          };
        }
        if (rawUrl === 'https://cdn.example/dynamic-module') {
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: Buffer.from('<div>ok</div>', 'utf8'),
          };
        }
        return {
          finalUrl: rawUrl,
          statusCode: 404,
          headers: { 'content-type': 'text/plain' },
          body: Buffer.from('not found'),
        };
      },
    },
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. ?debug=1 diagnostics
    const debugRes = await fetch(
      `${baseUrl}/api/proxy?u=${encodeProxyUrl('https://cf.example/challenge')}&debug=1`,
    );
    assert.equal(debugRes.status, 200);
    const debugJson = (await debugRes.json()) as {
      upstreamStatus: number;
      upstreamMime: string;
      finalUrl: string;
      rewritten: { links: number; assets: number };
      warnings: string[];
      durationMs: number;
    };
    assert.equal(debugJson.upstreamStatus, 403);
    assert.equal(debugJson.finalUrl, 'https://cf.example/challenge');
    assert.equal(debugJson.rewritten.links, 1);
    assert.equal(debugJson.rewritten.assets, 1);
    assert.ok(debugJson.warnings.some((w) => w.includes('Cloudflare')));
    assert.equal(typeof debugJson.durationMs, 'number');

    // 2. POST login + Set-Cookie rewrite + Cookie jar persistence across hops
    const postRes = await fetch(
      `${baseUrl}/api/proxy?u=${encodeProxyUrl('https://auth.example/login')}&sid=${sid}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-val-99',
        },
        body: JSON.stringify({ user: 'tester' }),
      },
    );
    assert.equal(postRes.status, 200);
    assert.equal(lastPostBody, JSON.stringify({ user: 'tester' }));
    assert.equal(lastForwardedCsrf, 'csrf-val-99');
    assert.equal(lastForwardedOrigin, 'https://auth.example');
    const setCookie = postRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('auth_token=tok123'));
    assert.ok(setCookie.includes('Path=/api/proxy'));
    assert.equal(setCookie.toLowerCase().includes('domain='), false);

    // Next request carries Cookie from jar automatically
    const meRes = await fetch(
      `${baseUrl}/api/proxy?u=${encodeProxyUrl('https://auth.example/me')}&sid=${sid}`,
    );
    assert.equal(meRes.status, 200);
    assert.equal(lastSeenCookie, 'auth_token=tok123');

    // 3. Sec-Fetch-Dest: script does not get blocked even if response is text/html
    const scriptAssetRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://cdn.example/dynamic-module')}`,
      { headers: { 'Sec-Fetch-Dest': 'script' } },
    );
    assert.equal(scriptAssetRes.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
