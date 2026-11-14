import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../../server.ts';
import { SlidingWindowRateLimiter } from '../../server/security/request-limits.ts';
import { InspectionStore } from '../../server/services/inspection-store.ts';
import { CapturedAssetStore } from '../../server/services/proxy/captured-store.ts';
import {
  rewriteCssUrls,
  rewriteEsModuleSpecifiers,
  rewriteHtmlDocument,
  rewriteM3u8Playlist,
} from '../../server/services/proxy/rewrite.ts';
import { buildProxyShim } from '../../server/services/proxy/shim.ts';
import {
  decodeProxyUrl,
  encodeProxyUrl,
  isExternalSiteUrl,
  normalizeProxyTarget,
} from '../../server/services/proxy/urlcodec.ts';
import { InspectionPolicyError } from '../../server/types/server.ts';

test('proxy urlcodec encodes, decodes, and normalizes HTTP/HTTPS URLs safely', () => {
  const encoded = encodeProxyUrl('https://example.com/path?a=1&b=2#top');
  assert.equal(decodeProxyUrl(encoded), 'https://example.com/path?a=1&b=2#top');
  assert.equal(
    normalizeProxyTarget('/gambar/hero.webp', 'https://example.com/profil'),
    'https://example.com/gambar/hero.webp',
  );
  assert.equal(
    normalizeProxyTarget('//cdn.example.com/a.css', 'https://example.com/'),
    'https://cdn.example.com/a.css',
  );
  assert.throws(() => normalizeProxyTarget('javascript:alert(1)'));
});

test('rewriteHtmlDocument strips CSP/integrity, prepends shim & base, and rewrites URLs to proxy origin', () => {
  const html = `<!doctype html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
  <link rel="icon" href="/favicon.ico" integrity="sha384-abc" crossorigin="anonymous">
  <style>.bg { background: url('/gambar/bg.webp'); }</style>
</head>
<body>
  <img src="/gambar/foto.webp" srcset="/gambar/foto-2x.webp 2x">
  <a href="/tentang">Tentang</a>
  <script type="module" src="/assets/index.js"></script>
</body>
</html>`;

  const shim = buildProxyShim('http://127.0.0.1:3000', 'https://spa.example/', 'sess-12345678');
  const out = rewriteHtmlDocument(
    html,
    'https://spa.example/',
    '',
    shim,
    'sess-12345678',
  );

  assert.equal(out.includes('Content-Security-Policy'), false);
  assert.equal(out.includes('integrity='), false);
  assert.equal(out.includes('crossorigin='), false);
  assert.ok(out.includes('<base href="/">'));
  assert.ok(out.includes('navigator.serviceWorker'));
  assert.ok(
    out.includes(
      `/api/asset?u=${encodeProxyUrl('https://spa.example/gambar/foto.webp')}`,
    ),
  );
  assert.ok(
    out.includes(
      `/api/proxy?u=${encodeProxyUrl('https://spa.example/tentang')}`,
    ),
  );
  assert.ok(out.includes('sid=sess-12345678'));
  assert.ok(shim.includes("method==='GET'||method==='HEAD'"));
});

test('rewriteCssUrls, rewriteEsModuleSpecifiers, and rewriteM3u8Playlist rewrite relative/root assets cleanly', () => {
  const css = rewriteCssUrls(
    `@import "/fonts.css"; .a{background:url('../img/a.webp')}`,
    'https://spa.example/styles/main.css',
    'http://127.0.0.1:3000',
  );
  assert.ok(css.includes('/api/asset?u='));
  assert.ok(css.includes(encodeProxyUrl('https://spa.example/fonts.css')));
  assert.ok(css.includes(encodeProxyUrl('https://spa.example/img/a.webp')));

  const js = rewriteEsModuleSpecifiers(
    `import { a } from "./vendor.js"; const p = import("/chunks/lazy.js"); const u = new URL("./pic.webp", import.meta.url);`,
    'https://spa.example/assets/index.js',
    'http://127.0.0.1:3000',
  );
  assert.ok(js.includes(encodeProxyUrl('https://spa.example/assets/vendor.js')));
  assert.ok(js.includes(encodeProxyUrl('https://spa.example/chunks/lazy.js')));
  assert.ok(js.includes('"https://spa.example/assets/index.js"'));

  const m3u8 = rewriteM3u8Playlist(
    `#EXTM3U\n#EXTINF:6,\nseg-1.ts\n`,
    'https://cdn.example/live/master.m3u8',
    'http://127.0.0.1:3000',
  );
  assert.ok(m3u8.includes(encodeProxyUrl('https://cdn.example/live/seg-1.ts')));
});

test('GET /api/proxy, /api/asset, and /api/captured enforce SSRF guard, frame headers, Range 206, and asset capture', async () => {
  const store = new InspectionStore();
  const capturedStore = new CapturedAssetStore();
  const sid = '11111111-1111-4111-8111-111111111111';

  const app = createApiApp(
    { store },
    { store },
    undefined,
    {
      store,
      capturedStore,
      proxyRateLimiter: new SlidingWindowRateLimiter(60_000, 30),
      assetRateLimiter: new SlidingWindowRateLimiter(60_000, 300),
      fetchProxy: async (rawUrl, options) => {
        if (rawUrl.startsWith('http://127.0.0.1')) {
          throw new InspectionPolicyError(
            'PROHIBITED_DESTINATION',
            'Alamat lokal dilarang.',
            403,
          );
        }

        if (rawUrl === 'https://spa.example/') {
          return {
            finalUrl: 'https://spa.example/',
            statusCode: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'x-frame-options': 'SAMEORIGIN',
            },
            body: Buffer.from(
              '<html><head><link rel="icon" href="/favicon.ico"></head><body><script type="module" src="/assets/app.js"></script></body></html>',
              'utf8',
            ),
          };
        }

        if (rawUrl === 'https://spa.example/gambar/hero.webp') {
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: { 'content-type': 'image/webp' },
            body: Buffer.from('WEBP_BYTES'),
          };
        }

        if (rawUrl === 'https://spa.example/media/clip.mp4') {
          const full = Buffer.from('0123456789ABCDEF');
          if (options?.range === 'bytes=0-3') {
            return {
              finalUrl: rawUrl,
              statusCode: 206,
              headers: {
                'content-type': 'video/mp4',
                'content-range': 'bytes 0-3/16',
                'content-length': '4',
              },
              body: full.subarray(0, 4),
            };
          }
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: { 'content-type': 'video/mp4' },
            body: full,
          };
        }

        throw new InspectionPolicyError('UPSTREAM_ERROR', 'Not found', 404);
      },
    },
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. SSRF private target blocked on /api/proxy with canonical code
    const ssrfRes = await fetch(
      `${baseUrl}/api/proxy?u=${encodeProxyUrl('http://127.0.0.1/admin')}`,
    );
    assert.equal(ssrfRes.status, 403);
    const ssrfJson = (await ssrfRes.json()) as { code: string; error: string };
    assert.equal(ssrfJson.code, 'private_host');

    // 1b. Invalid scheme returns bad_scheme
    const badRes = await fetch(
      `${baseUrl}/api/proxy?u=${encodeProxyUrl('javascript:alert(1)')}`,
    );
    assert.equal(badRes.status, 400);
    const badJson = (await badRes.json()) as { code: string };
    assert.equal(badJson.code, 'bad_scheme');

    // 2. HTML proxy removes XFO, sets AI Studio frame-ancestors + CORP cross-origin, and omits ACAO *
    const proxyRes = await fetch(
      `${baseUrl}/api/proxy?u=${encodeProxyUrl('https://spa.example/')}&sid=${sid}`,
    );
    assert.equal(proxyRes.status, 200);
    assert.equal(proxyRes.headers.get('x-frame-options'), null);
    const csp = proxyRes.headers.get('content-security-policy') || '';
    assert.ok(csp.includes('frame-ancestors'));
    assert.ok(csp.includes('https://aistudio.google.com'));
    assert.ok(csp.includes('https://*.googleusercontent.com'));
    assert.ok(csp.includes('https://*.run.app'));
    assert.equal(proxyRes.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(proxyRes.headers.get('referrer-policy'), 'no-referrer-when-downgrade');
    assert.equal(proxyRes.headers.get('access-control-allow-origin'), null);
    const html = await proxyRes.text();
    assert.ok(html.includes('navigator.serviceWorker'));
    assert.ok(html.includes(encodeProxyUrl('https://spa.example/assets/app.js')));

    // 2b. Top-level /view escape route redirects 302 to /api/proxy
    const viewRes = await fetch(
      `${baseUrl}/view?u=${encodeProxyUrl('https://spa.example/')}&sid=${sid}`,
      { redirect: 'manual' },
    );
    assert.equal(viewRes.status, 302);
    assert.equal(
      viewRes.headers.get('location'),
      `/api/proxy?u=${encodeProxyUrl('https://spa.example/')}&sid=${sid}`,
    );

    // 3. Asset proxy serves image with CORP cross-origin + records to /api/captured
    const imgRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://spa.example/gambar/hero.webp')}&sid=${sid}`,
    );
    assert.equal(imgRes.status, 200);
    assert.equal(imgRes.headers.get('access-control-allow-origin'), '*');
    assert.equal(imgRes.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(await imgRes.text(), 'WEBP_BYTES');

    // 4. Asset proxy forwards Range 206 for video seeking
    const rangeRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://spa.example/media/clip.mp4')}&sid=${sid}`,
      { headers: { Range: 'bytes=0-3' } },
    );
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-range'), 'bytes 0-3/16');
    assert.equal(rangeRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(await rangeRes.text(), '0123');

    // 5. Captured endpoint exposes runtime-observed image & video
    const capRes = await fetch(`${baseUrl}/api/captured?sid=${sid}`);
    assert.equal(capRes.status, 200);
    const capJson = (await capRes.json()) as {
      resources: Array<{ url: string; kind: string; source: string; observation: string }>;
    };
    assert.equal(capJson.resources.length, 2);
    assert.equal(capJson.resources[0].source, 'browser-observed');
    assert.equal(capJson.resources[0].observation, 'fetched');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('GET /api/proxy resolves meta-refresh/JS redirector pages directly to the final destination HTML', async () => {
  const store = new InspectionStore();
  const capturedStore = new CapturedAssetStore();
  const app = createApiApp(
    { store },
    { store },
    undefined,
    {
      store,
      capturedStore,
      proxyRateLimiter: new SlidingWindowRateLimiter(60_000, 30),
      assetRateLimiter: new SlidingWindowRateLimiter(60_000, 300),
      fetchProxy: async (rawUrl) => {
        if (rawUrl === 'https://go.example/short') {
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: Buffer.from(
              '<html><head><meta http-equiv="refresh" content="0;url=https://dest.example/landing"></head><body></body></html>',
              'utf8',
            ),
          };
        }
        return {
          finalUrl: 'https://dest.example/landing',
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: Buffer.from(
            '<html><head><title>Tujuan Akhir</title></head><body><img src="/hero.webp"></body></html>',
            'utf8',
          ),
        };
      },
    },
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(
      `${baseUrl}/api/proxy?u=${encodeProxyUrl('https://go.example/short')}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-frame-options'), null);
    const csp = res.headers.get('content-security-policy') || '';
    assert.ok(csp.includes('https://aistudio.google.com'));
    const html = await res.text();
    assert.ok(html.includes('<base href="/">'));
    assert.ok(html.includes(encodeProxyUrl('https://dest.example/hero.webp')));
    assert.equal(html.includes('https://go.example/short'), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('non-API app shell routes strip downstream X-Frame-Options and allow AI Studio multi-level framing', async () => {
  const app = createApiApp();
  app.get('/shell-probe', (_req, res) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.status(200).send('<!doctype html><html><body>ok</body></html>');
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/shell-probe`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-frame-options'), null);
    const csp = res.headers.get('content-security-policy') || '';
    assert.ok(csp.includes('frame-ancestors'));
    assert.ok(csp.includes('https://aistudio.google.com'));
    assert.ok(csp.includes('https://*.googleusercontent.com'));
    assert.ok(csp.includes('https://*.run.app'));
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer-when-downgrade');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('GET /api/asset sanitizes SVG payloads and serves PDF inline with frame-ancestors headers', async () => {
  const store = new InspectionStore();
  const capturedStore = new CapturedAssetStore();
  const app = createApiApp(
    { store },
    { store },
    undefined,
    {
      store,
      capturedStore,
      proxyRateLimiter: new SlidingWindowRateLimiter(60_000, 30),
      assetRateLimiter: new SlidingWindowRateLimiter(60_000, 300),
      fetchProxy: async (rawUrl) => {
        if (rawUrl === 'https://cdn.example/vector.svg') {
          return {
            finalUrl: rawUrl,
            statusCode: 200,
            headers: { 'content-type': 'image/svg+xml' },
            body: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><path d="M0 0h10v10H0z"/><a href="javascript:alert(3)">x</a></svg>',
              'utf8',
            ),
          };
        }
        return {
          finalUrl: rawUrl,
          statusCode: 200,
          headers: { 'content-type': 'application/pdf' },
          body: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF', 'utf8'),
        };
      },
    },
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const svgRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://cdn.example/vector.svg')}`,
    );
    assert.equal(svgRes.status, 200);
    assert.ok((svgRes.headers.get('content-type') || '').includes('image/svg+xml'));
    const svgText = await svgRes.text();
    assert.ok(svgText.includes('<path d="M0 0h10v10H0z"/>'));
    assert.equal(svgText.includes('<script'), false);
    assert.equal(svgText.includes('onload='), false);
    assert.equal(svgText.includes('javascript:'), false);

    const pdfRes = await fetch(
      `${baseUrl}/api/asset?u=${encodeProxyUrl('https://cdn.example/manual.pdf')}`,
    );
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    assert.equal(pdfRes.headers.get('content-disposition'), 'inline');
    assert.equal(pdfRes.headers.get('x-frame-options'), null);
    assert.ok((pdfRes.headers.get('content-security-policy') || '').includes('https://aistudio.google.com'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('rewriteHtmlDocument and buildProxyShim neutralize target=_blank, window.open popups, and clickjacking attributes', () => {
  const html = `<!doctype html>
<html>
<head><base target="_blank" href="https://spa.example/"></head>
<body>
  <a href="https://ad.example/jack" target="_blank" ping="https://track.example/hit">Promo</a>
  <area href="/next" target="_new" shape="rect" coords="0,0,10,10">
  <form action="/search" target="_blank">
    <button type="submit" formaction="/submit" formtarget="_top">Kirim</button>
  </form>
</body>
</html>`;

  const shim = buildProxyShim('http://127.0.0.1:3000', 'https://spa.example/watch', 'sess-antijack');
  const out = rewriteHtmlDocument(
    html,
    'https://spa.example/watch',
    '',
    shim,
    'sess-antijack',
  );

  assert.equal(/target\s*=\s*['"]?_blank/i.test(out), false);
  assert.equal(/target\s*=\s*['"]?_new/i.test(out), false);
  assert.equal(/formtarget\s*=\s*['"]?_top/i.test(out), false);
  assert.equal(/\sping=/i.test(out), false);
  assert.ok(shim.includes('blockedWindowOpen'));
  assert.ok(shim.includes('createDecoyWindow'));
  assert.ok(shim.includes('isClickjackOverlay'));
  assert.ok(shim.includes('unwrapProxied'));
});

test('external-link bypass detects external domains, rewrites forced external clicks/meta-refresh, and blocks bounce redirects', async () => {
  assert.equal(isExternalSiteUrl('https://sub.alvareza.my.id/p', 'https://www.alvareza.my.id/'), false);
  assert.equal(isExternalSiteUrl('https://ad-trap.example.com/offer', 'https://www.alvareza.my.id/'), true);

  const html = `<!doctype html>
<html>
<head><meta http-equiv="refresh" content="0; url=https://ad-trap.example.com/land"></head>
<body>
  <a href="/dalam-situs">Aman</a>
  <a href="https://ad-trap.example.com/click">Masuk</a>
  <button onclick="location.href='https://ad-trap.example.com/pop'; unlock()">Play</button>
</body>
</html>`;

  const shim = buildProxyShim('http://127.0.0.1:3000', 'https://site.example/watch', 'sess-ext1', {
    bypassExternalLinks: true,
    rootUrl: 'https://site.example/watch',
  });
  const out = rewriteHtmlDocument(
    html,
    'https://site.example/watch',
    '',
    shim,
    'sess-ext1',
    { bypassExternalLinks: true, rootUrl: 'https://site.example/watch' },
  );

  assert.equal(out.includes('http-equiv="refresh"'), false);
  assert.ok(out.includes('data-cdnfree-external="1"'));
  assert.ok(out.includes('window.__cdnfreeBypassExt'));
  assert.ok(shim.includes('cdnfree:external-bypassed'));

  const app = createApiApp(
    {},
    undefined,
    undefined,
    {
      store: new InspectionStore(),
      capturedStore: new CapturedAssetStore(),
      proxyRateLimiter: new SlidingWindowRateLimiter(60_000, 100),
      fetchProxy: async (rawUrl) => ({
        finalUrl: rawUrl.includes('/go') ? 'https://ad-trap.example.com/out' : rawUrl,
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from('<html><body>Target</body></html>'),
      }),
    },
  );

  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const bounceRes = await fetch(
      `${baseUrl}/api/proxy?u=${encodeProxyUrl('https://site.example/go')}&extbypass=1&root=${encodeProxyUrl('https://site.example/watch')}`,
    );
    assert.equal(bounceRes.status, 200);
    const bounceHtml = await bounceRes.text();
    assert.ok(bounceHtml.includes('cdnfree:external-bypassed'));
    assert.equal(bounceHtml.includes('<body>Target</body>'), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

