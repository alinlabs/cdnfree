import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSmartCacheHlsUrl,
  buildSmartCacheMediaUrl,
  resolveVideoSourcePlan,
  shouldPreferStreamInitially,
} from '../../src/utils/video-source-strategy.ts';
import type { ResourceRecord } from '../../src/types/inspection.ts';

function makeVideo(overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    id: 'vid-1',
    url: 'https://cdn.example.com/clip.mp4',
    host: 'cdn.example.com',
    kind: 'video',
    assetKind: 'video',
    mimeType: 'video/mp4',
    observation: 'discovered',
    source: 'html-video',
    classification: 'allowed',
    ...overrides,
  };
}

test('resolveVideoSourcePlan prioritizes offline SmartCache over network and HLS', () => {
  const plan = resolveVideoSourcePlan({
    resource: makeVideo(),
    inspectionId: 'insp-1',
    smartCacheKey: 'sc-abc123',
    isCachedOffline: true,
    cachedMediaUrl: null,
  });

  assert.equal(plan.initialMode, 'cache');
  assert.equal(plan.isOfflineCached, true);
  assert.equal(plan.activeSrc, buildSmartCacheMediaUrl('sc-abc123'));

  const hlsCached = resolveVideoSourcePlan({
    resource: makeVideo({
      url: 'https://cdn.example.com/master.m3u8',
      assetKind: 'hls',
      hlsUrl: 'https://cdn.example.com/master.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
    }),
    inspectionId: 'insp-1',
    smartCacheKey: 'sc-hls1',
    isCachedOffline: true,
  });
  assert.equal(hlsCached.initialMode, 'cache');
  assert.equal(hlsCached.isHls, true);
  assert.equal(hlsCached.hlsSrc, buildSmartCacheHlsUrl('sc-hls1'));
});

test('shouldPreferStreamInitially skips direct attempt when referer, 403 probe, browser-observed, or directFailed applies', () => {
  assert.equal(shouldPreferStreamInitially(makeVideo()), false);
  assert.equal(
    shouldPreferStreamInitially(makeVideo({ referer: 'https://site.example/watch' })),
    true,
  );
  assert.equal(
    shouldPreferStreamInitially(makeVideo({ source: 'browser-observed' })),
    true,
  );
  assert.equal(
    shouldPreferStreamInitially(
      makeVideo({ probe: { status: 'unverified', httpStatus: 403, reason: 'http-403' } }),
    ),
    true,
  );
  assert.equal(
    shouldPreferStreamInitially(makeVideo(), { directFailed: true }),
    true,
  );

  // Local app bundled videos never prefer external stream fallback
  assert.equal(
    shouldPreferStreamInitially(makeVideo({ url: '/assets/into-landscape-123.mp4' })),
    false,
  );
});

test('resolveVideoSourcePlan routes bookmarked HLS with referer through /api/asset proxy', () => {
  const plan = resolveVideoSourcePlan({
    resource: makeVideo({
      url: 'https://cdn.example.com/stream/playlist.m3u8',
      assetKind: 'hls',
      hlsUrl: 'https://cdn.example.com/stream/playlist.m3u8',
      referer: 'https://player.example.com/embed',
    }),
    smartCacheKey: 'sc-hls2',
  });

  assert.equal(plan.initialMode, 'hls');
  assert.equal(plan.isHls, true);
  assert.ok(plan.hlsSrc?.startsWith('/api/asset?u='));
  assert.ok(plan.hlsSrc?.includes('ref='));
});
