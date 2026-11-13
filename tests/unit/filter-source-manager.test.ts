import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  FilterSourceManager,
  SourceFetchError,
  safeFetchFilterSource,
  type FetchFilterSourceFn,
  type RemoteFilterSourceSpec,
} from '../../server/services/filter-source-manager.ts';

function makeValidList(prefix: string, count = 12): string {
  const rules = [
    '! Title: Test Feed',
    '! Last modified: 2026-11-13',
  ];
  for (let i = 0; i < count; i += 1) {
    rules.push(`||${prefix}-${i}.tracker.example^`);
  }
  return rules.join('\n');
}

const TEST_SPEC: RemoteFilterSourceSpec = {
  id: 'test-easylist',
  name: 'Test Remote Feed',
  purpose: 'Testing safe refresh pipeline',
  sourceUrl: 'https://easylist.to/easylist/test.txt',
  allowedOrigins: ['https://easylist.to'],
  attribution: 'EasyList Authors',
  license: 'CC BY-SA 3.0 / GPLv3',
  syntaxScope: 'Network subset',
};

test('FilterSourceManager starts honestly with bundled fallback and un-synced remote sources as stale', () => {
  const manager = new FilterSourceManager({ remoteSpecs: [TEST_SPEC] });
  const status = manager.getStatusSnapshot();
  assert.equal(status.sources.length, 2);
  assert.equal(status.sources[0].freshness, 'fallback');
  assert.equal(status.sources[1].freshness, 'stale');
  assert.equal(status.sources[1].fetchedAt, null);
});

test('FilterSourceManager activates valid candidate, handles 304 Not Modified, and detects stale expiry', async () => {
  let nowMs = Date.parse('2026-11-13T10:00:00.000Z');
  const feedBody = makeValidList('valid', 12);

  let mode: 'ok' | '304' = 'ok';
  let seenIfNoneMatch: string | undefined;

  const fetchSource: FetchFilterSourceFn = async (_spec, conditional) => {
    seenIfNoneMatch = conditional.etag;
    if (mode === '304') {
      return { kind: 'not-modified', etag: '"v1"' };
    }
    return {
      kind: 'ok',
      text: feedBody,
      etag: '"v1"',
      lastModified: 'Fri, 13 Nov 2026 09:00:00 GMT',
      contentType: 'text/plain',
    };
  };

  const manager = new FilterSourceManager({
    remoteSpecs: [TEST_SPEC],
    fetchSource,
    maxAgeMs: 60_000,
    now: () => new Date(nowMs),
  });

  const first = await manager.refreshAll();
  assert.equal(first.refreshedCount, 1);
  assert.equal(first.failedCount, 0);
  const activeHit = manager
    .getActiveEngine()
    .evaluateUrl('https://valid-5.tracker.example/x.js', 'news.example');
  assert.equal(activeHit.matched, true);
  assert.equal(activeHit.sourceId, 'test-easylist');

  // Conditional 304 preserves active rules and sends previous ETag
  nowMs += 30_000;
  mode = '304';
  const second = await manager.refreshAll();
  assert.equal(seenIfNoneMatch, '"v1"');
  assert.equal(second.unchangedCount, 1);
  assert.equal(second.sources[1].freshness, 'fresh');
  assert.equal(
    manager.getActiveEngine().evaluateUrl('https://valid-5.tracker.example/x.js', 'news.example').matched,
    true,
  );

  // Exceeding maxAgeMs marks previously fresh remote source as stale
  nowMs += 120_000;
  const expiredSnapshot = manager.getStatusSnapshot();
  assert.equal(expiredSnapshot.sources[1].freshness, 'stale');
});

test('FilterSourceManager preserves last-known-good dataset on timeout, empty, HTML, malformed, checksum mismatch, or error updates', async () => {
  const validList = makeValidList('lkg', 12);
  let nextResponse: (() => Promise<Awaited<ReturnType<FetchFilterSourceFn>>>) = async () => ({
    kind: 'ok',
    text: validList,
    etag: '"lkg-1"',
    contentType: 'text/plain',
  });

  const expectedDigest = crypto.createHash('sha256').update(validList, 'utf8').digest('hex');
  const specWithHash: RemoteFilterSourceSpec = {
    ...TEST_SPEC,
    expectedSha256: expectedDigest,
  };

  const manager = new FilterSourceManager({
    remoteSpecs: [specWithHash],
    fetchSource: async () => nextResponse(),
  });

  const okInit = await manager.refreshAll();
  assert.equal(okInit.refreshedCount, 1);

  const failureScenarios: Array<{
    name: string;
    responder: () => Promise<Awaited<ReturnType<FetchFilterSourceFn>>>;
  }> = [
    {
      name: 'timeout error',
      responder: async () => {
        throw new SourceFetchError('Waktu koneksi pembaruan daftar filter habis.');
      },
    },
    {
      name: 'wrong content type',
      responder: async () => ({
        kind: 'ok',
        text: validList,
        contentType: 'text/html',
      }),
    },
    {
      name: 'oversized payload',
      responder: async () => ({
        kind: 'ok',
        text: `${validList}\n! ${'a'.repeat(8 * 1024 * 1024 + 64)}`,
        contentType: 'text/plain',
      }),
    },
    {
      name: 'empty body',
      responder: async () => ({ kind: 'ok', text: '   ', contentType: 'text/plain' }),
    },
    {
      name: 'HTML response disguised as text/plain',
      responder: async () => ({
        kind: 'ok',
        text: '<!DOCTYPE html><html><body>Access denied</body></html>',
        contentType: 'text/plain',
      }),
    },
    {
      name: 'too few valid rules',
      responder: async () => ({
        kind: 'ok',
        text: '||onlyone.example^\n||onlytwo.example^',
        contentType: 'text/plain',
      }),
    },
    {
      name: 'high parse error count',
      responder: async () => ({
        kind: 'ok',
        text: [
          ...Array.from({ length: 12 }, (_, i) => `||valid-${i}.example^`),
          ...Array.from({ length: 40 }, () => '||bad*host^'),
        ].join('\n'),
        contentType: 'text/plain',
      }),
    },
    {
      name: 'SHA-256 checksum mismatch',
      responder: async () => ({
        kind: 'ok',
        text: makeValidList('tampered', 12),
        contentType: 'text/plain',
      }),
    },
  ];

  for (const scenario of failureScenarios) {
    nextResponse = scenario.responder;
    const summary = await manager.refreshAll();
    assert.equal(summary.failedCount, 1, `Expected failure for ${scenario.name}`);
    assert.equal(summary.sources[1].freshness, 'stale', `Expected stale fallback for ${scenario.name}`);
    assert.ok(summary.sources[1].lastError, `Expected visible error message for ${scenario.name}`);
    // Critical: Last-Known-Good rules from lkg-* must still match!
    assert.equal(
      manager.getActiveEngine().evaluateUrl('https://lkg-3.tracker.example/s.js', 'news.example').matched,
      true,
      `Last-known-good rule lost after ${scenario.name}`,
    );
  }
});

test('safeFetchFilterSource blocks non-allowlisted origins, plain HTTP, and DNS resolving to prohibited private IP', async () => {
  await assert.rejects(
    () =>
      safeFetchFilterSource(
        {
          ...TEST_SPEC,
          sourceUrl: 'http://easylist.to/easylist/easylist.txt',
        },
        {},
      ),
    (err: unknown) => err instanceof SourceFetchError,
  );

  await assert.rejects(
    () =>
      safeFetchFilterSource(
        {
          ...TEST_SPEC,
          sourceUrl: 'https://evil-mirror.example/list.txt',
        },
        {},
      ),
    (err: unknown) => err instanceof SourceFetchError,
  );

  await assert.rejects(
    () =>
      safeFetchFilterSource(TEST_SPEC, {}, async () => [
        { address: '169.254.169.254', family: 4 },
      ]),
    (err: unknown) => err instanceof SourceFetchError,
  );
});
