import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSmartCacheHlsUrl,
  buildSmartCacheMediaUrl,
  resolveVideoSourcePlan,
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

test('resolveVideoSourcePlan prioritizes offline SmartCache over direct and HLS', () => {
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
  assert.equal(plan.canFallbackToStream, false);

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

test('resolveVideoSourcePlan always uses direct playback for progressive HTTP(S) videos without proxy stream layer', () => {
  const cases: Array<ResourceRecord> = [
    makeVideo(),
    makeVideo({ referer: 'https://site.example/watch' }),
    makeVideo({ source: 'browser-observed' }),
    makeVideo({ probe: { status: 'unverified', httpStatus: 403, reason: 'http-403' } }),
    makeVideo({ url: '/assets/into-landscape-123.mp4' }),
  ];

  for (const resource of cases) {
    const plan = resolveVideoSourcePlan({
      resource,
      inspectionId: '11111111-1111-4111-8111-111111111111',
      smartCacheKey: 'sc-direct',
      snapshot: { preferredSourceMode: 'stream', directFailed: true },
    });

    assert.equal(plan.initialMode, 'direct');
    assert.equal(plan.activeSrc, resource.url);
    assert.equal(plan.canFallbackToStream, false);
    assert.equal(plan.isHls, false);
  }
});

test('resolveVideoSourcePlan retains streamSrc for background thumbnail capture and SmartCache hydration', () => {
  const plan = resolveVideoSourcePlan({
    resource: makeVideo({
      url: 'https://cdn.example.com/clip.mp4',
      referer: 'https://site.example/watch',
    }),
    inspectionId: '',
    smartCacheKey: 'sc-thumb',
  });

  assert.equal(plan.initialMode, 'direct');
  assert.equal(plan.activeSrc, 'https://cdn.example.com/clip.mp4');
  assert.ok(plan.streamSrc.startsWith('/api/asset?u='));
  assert.ok(plan.streamSrc.includes('ref='));
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
