import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FilterEngine,
  defaultFilterEngine,
  parseFilterListText,
} from '../../server/services/filter-engine.ts';

test('parseFilterListText parses network rules, exceptions, and skips cosmetic rules with accurate stats', () => {
  const sampleList = `
! Title: Test List
! Last modified: 2026-11-10
||ads.example.com^
||tracker.example.net^$third-party,script
@@||allowed.ads.example.com^
example.com##.ad-banner
/pagead/$third-party
`;

  const parsed = parseFilterListText(sampleList, {
    id: 'test-list',
    name: 'Test List',
    sourceUrl: 'https://easylist.to/',
    attribution: 'EasyList Authors',
    license: 'CC BY-SA 3.0',
    updatedAt: '2026-01-01',
    syntaxScope: 'Network subset',
  });

  assert.equal(parsed.metadata.updatedAt, '2026-11-10');
  assert.equal(parsed.metadata.supportedNetworkRules, 4);
  assert.equal(parsed.metadata.skippedRules, 1);
  assert.equal(parsed.metadata.parseErrors, 0);

  const engine = new FilterEngine(
    [parsed.metadata],
    parsed.allowRules,
    parsed.blockRules,
  );

  // Matches subdomain of ||ads.example.com^
  const adMatch = engine.evaluateUrl(
    'https://static.ads.example.com/banner.js',
    'news.example.org',
    { kind: 'script' },
  );
  assert.equal(adMatch.matched, true);
  assert.equal(adMatch.classification, 'ad-or-tracker');

  // Filter exception @@||allowed.ads.example.com^ takes precedence
  const exceptionMatch = engine.evaluateUrl(
    'https://allowed.ads.example.com/ok.js',
    'news.example.org',
    { kind: 'script' },
  );
  assert.equal(exceptionMatch.matched, false);
  assert.equal(exceptionMatch.decision, 'allowed_by_exception');

  // $third-party rule does NOT match first-party host
  const firstParty = engine.evaluateUrl(
    'https://tracker.example.net/metric.js',
    'tracker.example.net',
    { kind: 'script' },
  );
  assert.equal(firstParty.matched, false);

  // Exact user allowlist host takes highest precedence
  const userAllow = engine.evaluateUrl(
    'https://ads.example.com/widget.js',
    'news.example.org',
    { kind: 'script', userAllowlistedHosts: ['ads.example.com'] },
  );
  assert.equal(userAllow.matched, false);
  assert.equal(userAllow.decision, 'allowed_by_user');
});

test('defaultFilterEngine exposes attribution metadata and matches known ad domain', () => {
  const sources = defaultFilterEngine.getSourcesStatus();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].status, 'active');
  assert.equal(sources[0].freshness, 'fallback');
  assert.ok(sources[0].attribution.includes('EasyList'));
  assert.ok(sources[0].supportedNetworkRules >= 20);

  const hit = defaultFilterEngine.evaluateUrl(
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    'example.com',
    { kind: 'script' },
  );
  assert.equal(hit.matched, true);
  assert.equal(hit.classification, 'ad-or-tracker');
});

test('parseFilterListText strictly skips unsupported modifiers instead of dropping conditions and over-blocking', () => {
  const trickyList = `
# last updated: 2026-11-12
||example-cdn.net^$popup
||example-cdn.net^$badfilter
||example-cdn.net^$csp=script-src 'none'
||example-cdn.net^$removeparam=utm_source
||example-cdn.net^banner*widget
||only-ads.example^$script
`;

  const parsed = parseFilterListText(trickyList, {
    id: 'strict-test',
    name: 'Strict Parser Test',
    sourceUrl: 'https://pgl.yoyo.org/',
    attribution: 'Test Author',
    license: 'GPLv3',
    updatedAt: '2026-01-01',
    syntaxScope: 'Network subset',
  });

  assert.equal(parsed.metadata.updatedAt, '2026-11-12');
  assert.equal(parsed.metadata.supportedNetworkRules, 1);
  assert.equal(parsed.metadata.skippedRules, 5);

  const engine = new FilterEngine([parsed.metadata], parsed.allowRules, parsed.blockRules);
  // None of the unsupported-modifier rules may block example-cdn.net!
  const cdnScript = engine.evaluateUrl(
    'https://example-cdn.net/app.js',
    'portal.example',
    { kind: 'script' },
  );
  assert.equal(cdnScript.matched, false);
});

test('FilterEngine indexes large 20,000-rule datasets and resolves multi-source conflicts deterministically', () => {
  const lines: string[] = [];
  for (let i = 0; i < 20_000; i += 1) {
    lines.push(`||tracker-${i}.ads.example^$third-party`);
  }
  const sourceA = parseFilterListText(lines.join('\n'), {
    id: 'source-a',
    name: 'Source A',
    sourceUrl: 'https://easylist.to/',
    attribution: 'EasyList',
    license: 'GPLv3',
    updatedAt: '2026-11-13',
    syntaxScope: 'Network subset',
  });
  const sourceB = parseFilterListText(
    '@@||tracker-42.ads.example^\n||tracker-99.ads.example^',
    {
      id: 'source-b',
      name: 'Source B',
      sourceUrl: 'https://pgl.yoyo.org/',
      attribution: 'Peter Lowe',
      license: 'Attribution',
      updatedAt: '2026-11-13',
      syntaxScope: 'Network subset',
    },
  );

  const engine = new FilterEngine(
    [sourceA.metadata, sourceB.metadata],
    [...sourceA.allowRules, ...sourceB.allowRules],
    [...sourceA.blockRules, ...sourceB.blockRules],
  );

  // Exception from Source B overrides block rule from Source A
  const conflictResolved = engine.evaluateUrl(
    'https://sub.tracker-42.ads.example/pixel.js',
    'news.example.co.id',
    { kind: 'script' },
  );
  assert.equal(conflictResolved.matched, false);
  assert.equal(conflictResolved.decision, 'allowed_by_exception');
  assert.equal(conflictResolved.sourceId, 'source-b');

  // Indexed lookup handles 1,000 queries across 20,000 rules well within 250ms
  const startMs = Date.now();
  let hits = 0;
  for (let i = 0; i < 1000; i += 1) {
    const res = engine.evaluateUrl(
      `https://cdn.tracker-${(i * 19) % 20_000}.ads.example/a.js`,
      'portal.example.org',
      { kind: 'script' },
    );
    if (res.matched) hits += 1;
  }
  const elapsedMs = Date.now() - startMs;
  assert.ok(hits > 900);
  assert.ok(elapsedMs < 250, `Expected <250ms for 1,000 queries on 20k rules, got ${elapsedMs}ms`);
});
