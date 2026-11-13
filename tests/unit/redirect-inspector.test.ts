import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectUrlTarget } from '../../server/services/redirect-inspector.ts';
import { InspectionPolicyError, type DnsLookupFn } from '../../server/types/server.ts';
import type { FetchHopFn } from '../../server/services/safe-fetch.ts';

const publicDns: DnsLookupFn = async (hostname) => {
  if (hostname === 'evil-internal.example') {
    return [{ address: '10.0.0.12', family: 4 }];
  }
  return [{ address: '93.184.216.34', family: 4 }];
};

test('inspectUrlTarget follows bounded redirects, extracts title/frame policy, and flags HTTPS downgrade', async () => {
  const fetchHop: FetchHopFn = async (target) => {
    if (target.normalizedUrl === 'https://short.example/go') {
      return {
        kind: 'redirect',
        statusCode: 302,
        location: 'http://dest.example/landing',
        headers: { location: 'http://dest.example/landing' },
      };
    }
    return {
      kind: 'document',
      statusCode: 200,
      contentType: 'text/html',
      bodyText:
        '<html><head><title>Halaman Tujuan</title><meta name="description" content="Deskripsi aman"></head><body>Halo</body></html>',
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'SAMEORIGIN',
      },
    };
  };

  const result = await inspectUrlTarget('https://short.example/go', {
    dnsLookup: publicDns,
    fetchHop,
  });

  assert.equal(result.submittedUrl, 'https://short.example/go');
  assert.equal(result.finalUrl, 'http://dest.example/landing');
  assert.equal(result.page.title, 'Halaman Tujuan');
  assert.equal(result.page.description, 'Deskripsi aman');
  assert.equal(result.redirects.length, 1);
  assert.equal(result.redirects[0].statusCode, 302);
  assert.ok(result.redirects[0].reason?.includes('HTTPS ke HTTP'));
  assert.equal(result.preview.mode, 'external-only');
});

test('inspectUrlTarget rejects redirect to prohibited IP or prohibited DNS host', async () => {
  const toLiteralIp: FetchHopFn = async () => ({
    kind: 'redirect',
    statusCode: 302,
    location: 'http://169.254.169.254/latest/meta-data/',
    headers: {},
  });

  await assert.rejects(
    () =>
      inspectUrlTarget('https://public.example/start', {
        dnsLookup: publicDns,
        fetchHop: toLiteralIp,
      }),
    (err: unknown) =>
      err instanceof InspectionPolicyError &&
      err.code === 'PROHIBITED_DESTINATION',
  );

  const toInternalDns: FetchHopFn = async () => ({
    kind: 'redirect',
    statusCode: 301,
    location: 'https://evil-internal.example/admin',
    headers: {},
  });

  await assert.rejects(
    () =>
      inspectUrlTarget('https://public.example/start', {
        dnsLookup: publicDns,
        fetchHop: toInternalDns,
      }),
    (err: unknown) =>
      err instanceof InspectionPolicyError &&
      err.code === 'PROHIBITED_DESTINATION',
  );
});

test('inspectUrlTarget rejects redirect loops, excessive hops, and protocol downgrade when policy requires', async () => {
  const loopFetch: FetchHopFn = async (target) => ({
    kind: 'redirect',
    statusCode: 302,
    location:
      target.url.pathname === '/a'
        ? 'https://loop.example/b'
        : 'https://loop.example/a',
    headers: {},
  });

  await assert.rejects(
    () =>
      inspectUrlTarget('https://loop.example/a', {
        dnsLookup: publicDns,
        fetchHop: loopFetch,
      }),
    (err: unknown) =>
      err instanceof InspectionPolicyError && err.code === 'REDIRECT_LOOP',
  );

  let hopNum = 0;
  const excessiveFetch: FetchHopFn = async () => {
    hopNum += 1;
    return {
      kind: 'redirect',
      statusCode: 302,
      location: `https://chain.example/step-${hopNum}`,
      headers: {},
    };
  };

  await assert.rejects(
    () =>
      inspectUrlTarget('https://chain.example/step-0', {
        dnsLookup: publicDns,
        fetchHop: excessiveFetch,
      }),
    (err: unknown) =>
      err instanceof InspectionPolicyError &&
      err.code === 'TOO_MANY_REDIRECTS',
  );

  const downgradeFetch: FetchHopFn = async () => ({
    kind: 'redirect',
    statusCode: 302,
    location: 'http://plain.example/',
    headers: {},
  });

  await assert.rejects(
    () =>
      inspectUrlTarget('https://secure.example/', {
        dnsLookup: publicDns,
        fetchHop: downgradeFetch,
        rejectProtocolDowngrade: true,
      }),
    (err: unknown) =>
      err instanceof InspectionPolicyError &&
      err.code === 'PROHIBITED_DESTINATION',
  );
});

test('evaluateFramePolicy handles multi-value CSP headers, ALLOW-FROM, none, self, and wildcard accurately', async () => {
  const { evaluateFramePolicy } = await import(
    '../../server/security/response-sanitizer.ts'
  );

  assert.equal(evaluateFramePolicy('ALLOW-FROM https://partner.example', undefined).embeddable, false);
  assert.equal(
    evaluateFramePolicy(undefined, ["default-src 'self'", "frame-ancestors 'self'"]).embeddable,
    false,
  );
  assert.equal(
    evaluateFramePolicy(undefined, "default-src 'self', frame-ancestors 'none'").embeddable,
    false,
  );
  assert.equal(
    evaluateFramePolicy(undefined, "default-src 'self'; frame-ancestors *").embeddable,
    true,
  );
  assert.equal(evaluateFramePolicy(undefined, undefined).embeddable, true);
});

test('inspectUrlTarget detects hash-variant redirect loops immediately', async () => {
  const hashLoopFetch: FetchHopFn = async (target) => ({
    kind: 'redirect',
    statusCode: 302,
    location: `${target.url.origin}${target.url.pathname}#loop-step`,
    headers: {},
  });

  await assert.rejects(
    () =>
      inspectUrlTarget('https://loop-hash.example/entry', {
        dnsLookup: publicDns,
        fetchHop: hashLoopFetch,
      }),
    (err: unknown) =>
      err instanceof InspectionPolicyError && err.code === 'REDIRECT_LOOP',
  );
});

test('inspectUrlTarget includes known-malicious links in summary.reviewCount', async () => {
  const { FilterEngine } = await import('../../server/services/filter-engine.ts');
  const engine = new FilterEngine([], [], []);
  engine.evaluateUrl = ((rawUrl: string) => {
    if (rawUrl.includes('bad-phish.example')) {
      return {
        matched: true,
        classification: 'known-malicious',
        decision: 'matched_block_rule',
        reason: 'Cocok dengan feed ancaman uji.',
      };
    }
    return { matched: false, classification: 'allowed', decision: 'no_match' };
  }) as typeof engine.evaluateUrl;

  const result = await inspectUrlTarget('https://portal.example/', {
    dnsLookup: publicDns,
    filterEngine: engine,
    fetchHop: async () => ({
      kind: 'document',
      statusCode: 200,
      contentType: 'text/html',
      bodyText:
        '<html><body><a href="https://bad-phish.example/login">Login</a><a href="https://cdn.example.com/ok">OK</a></body></html>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  });

  assert.equal(result.summary.flaggedCount, 1);
  assert.equal(result.summary.reviewCount, 1);
});

test('inspectUrlTarget follows HTTP 302, meta refresh, and JS redirect stubs and extracts info/assets from the final destination', async () => {
  const fetchHop: FetchHopFn = async (target) => {
    if (target.normalizedUrl === 'https://short.example/start') {
      return {
        kind: 'redirect',
        statusCode: 302,
        location: 'https://hop1.example/meta',
        headers: { location: 'https://hop1.example/meta' },
      };
    }
    if (target.normalizedUrl === 'https://hop1.example/meta') {
      return {
        kind: 'document',
        statusCode: 200,
        contentType: 'text/html',
        bodyText:
          '<html><head><title>Redirecting...</title><meta http-equiv="refresh" content="0;url=https://hop2.example/js"></head><body><img src="/bridge-tracker.png"></body></html>',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      };
    }
    if (target.normalizedUrl === 'https://hop2.example/js') {
      return {
        kind: 'document',
        statusCode: 200,
        contentType: 'text/html',
        bodyText:
          '<html><head><title>Forwarder</title><script>window.location.replace("https://final.example/real-page");</script></head><body></body></html>',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      };
    }
    return {
      kind: 'document',
      statusCode: 200,
      contentType: 'text/html',
      bodyText:
        '<html><head><title>Konten Asli Tujuan Akhir</title></head><body><img src="/assets/hero-real.webp"><a href="/artikel">Baca</a></body></html>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
    };
  };

  const result = await inspectUrlTarget('https://short.example/start', {
    dnsLookup: publicDns,
    fetchHop,
  });

  assert.equal(result.submittedUrl, 'https://short.example/start');
  assert.equal(result.finalUrl, 'https://final.example/real-page');
  assert.equal(result.page.title, 'Konten Asli Tujuan Akhir');
  assert.equal(result.redirects.length, 3);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].url, 'https://final.example/assets/hero-real.webp');
  assert.equal(
    result.resources.some((r) => r.url.includes('bridge-tracker.png')),
    false,
  );
  assert.equal(result.links[0].href, 'https://final.example/artikel');
});

test('inspectUrlTarget enforces SSRF guard against client-side meta refresh redirects to private hosts', async () => {
  const fetchHop: FetchHopFn = async () => ({
    kind: 'document',
    statusCode: 200,
    contentType: 'text/html',
    bodyText:
      '<html><head><meta http-equiv="refresh" content="0;url=http://127.0.0.1/secret"></head><body></body></html>',
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  await assert.rejects(
    () =>
      inspectUrlTarget('https://public.example/meta-ssrf', {
        dnsLookup: publicDns,
        fetchHop,
      }),
    (err: unknown) =>
      err instanceof InspectionPolicyError &&
      err.code === 'PROHIBITED_DESTINATION',
  );
});


