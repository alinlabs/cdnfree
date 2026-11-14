import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../../server.ts';
import { FilterSourceManager } from '../../server/services/filter-source-manager.ts';

function buildFixtureFeed(domain: string, count = 12): string {
  const lines = ['! Title: Integration Remote List', '! Last modified: 2026-11-13', `||${domain}^`];
  for (let i = 0; i < count; i += 1) {
    lines.push(`||extra-${i}.${domain}^`);
  }
  return lines.join('\n');
}

test('GET /api/filters/status and POST /api/filters/refresh update active inspection matching safely with CSRF and rate controls', async () => {
  const manager = new FilterSourceManager({
    remoteSpecs: [
      {
        id: 'integration-remote',
        name: 'Integration Filter Feed',
        purpose: 'Test feed',
        sourceUrl: 'https://easylist.to/easylist/easylist.txt',
        allowedOrigins: ['https://easylist.to'],
        attribution: 'EasyList',
        license: 'CC BY-SA 3.0',
        syntaxScope: 'Network subset',
      },
    ],
    fetchSource: async () => ({
      kind: 'ok',
      text: buildFixtureFeed('new-dynamic-ad.example'),
      etag: '"int-1"',
      contentType: 'text/plain',
    }),
  });

  const app = createApiApp(
    {
      inspectOptions: {
        dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchHop: async () => ({
          kind: 'document',
          statusCode: 200,
          contentType: 'text/html',
          bodyText:
            '<html><head><script src="https://new-dynamic-ad.example/ad.js"></script></head></html>',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      },
    },
    undefined,
    manager,
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Initial status shows bundled fallback + un-synced remote source
    const statusRes = await fetch(`${baseUrl}/api/filters/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as {
      sources: Array<{ id: string; freshness: string }>;
    };
    assert.equal(statusJson.sources.length, 2);
    assert.equal(statusJson.sources[1].freshness, 'stale');

    // 2. Before refresh, new-dynamic-ad.example is not matched
    const beforeInspect = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://portal.example/' }),
    });
    assert.equal(beforeInspect.status, 200);
    const beforeJson = (await beforeInspect.json()) as {
      resources: Array<{ host: string; classification: string }>;
    };
    assert.equal(beforeJson.resources[0].classification, 'allowed');

    // 3. Cross-site CSRF guard rejects POST /api/filters/refresh
    const csrfRes = await fetch(`${baseUrl}/api/filters/refresh`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(csrfRes.status, 403);

    // 4. Same-origin POST /api/filters/refresh activates validated candidate
    const refreshRes = await fetch(`${baseUrl}/api/filters/refresh`, {
      method: 'POST',
    });
    assert.equal(refreshRes.status, 200);
    const refreshJson = (await refreshRes.json()) as {
      refreshedCount: number;
      sources: Array<{ freshness: string }>;
    };
    assert.equal(refreshJson.refreshedCount, 1);
    assert.equal(refreshJson.sources[1].freshness, 'fresh');

    // 5. Subsequent inspection uses updated FilterEngine immediately
    const afterInspect = await fetch(`${baseUrl}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://portal.example/' }),
    });
    assert.equal(afterInspect.status, 200);
    const afterJson = (await afterInspect.json()) as {
      resources: Array<{ host: string; classification: string; reason?: string }>;
    };
    assert.equal(afterJson.resources[0].classification, 'ad-or-tracker');
    assert.ok(afterJson.resources[0].reason?.includes('Integration Filter Feed'));

    // 6. Rate limiter protects /api/filters/refresh after 6 calls in 1 minute
    for (let i = 0; i < 5; i += 1) {
      const ok = await fetch(`${baseUrl}/api/filters/refresh`, { method: 'POST' });
      assert.equal(ok.status, 200);
    }
    const limited = await fetch(`${baseUrl}/api/filters/refresh`, { method: 'POST' });
    assert.equal(limited.status, 429);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
