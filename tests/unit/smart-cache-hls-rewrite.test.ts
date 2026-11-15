import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isVodHlsPlaylist,
  parseHlsManifest,
  rewriteHlsPlaylistToLocal,
  selectOptimalHlsVariant,
} from '../../src/services/smart-cache-hls.ts';

test('parseHlsManifest parses master variants and selects optimal variant under 4 Mbps cap', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
    'low/index.m3u8?token=abc',
    '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
    'mid/index.m3u8?token=abc',
    '#EXT-X-STREAM-INF:BANDWIDTH=9500000,RESOLUTION=3840x2160',
    'uhd/index.m3u8?token=abc',
  ].join('\n');

  const parsed = parseHlsManifest(master, 'https://cdn.example.com/v1/master.m3u8');
  assert.equal(parsed.isMaster, true);
  assert.equal(parsed.variants.length, 3);

  const chosen = selectOptimalHlsVariant(parsed.variants);
  assert.ok(chosen);
  assert.equal(chosen.bandwidth, 2800000);
  assert.equal(chosen.url, 'https://cdn.example.com/v1/mid/index.m3u8?token=abc');
});

test('isVodHlsPlaylist rejects live streams missing #EXT-X-ENDLIST', () => {
  const live = [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:6',
    '#EXTINF:6.0,',
    'seg101.ts',
    '#EXTINF:6.0,',
    'seg102.ts',
  ].join('\n');

  const vod = `${live}\n#EXT-X-ENDLIST\n`;
  assert.equal(isVodHlsPlaylist(live), false);
  assert.equal(isVodHlsPlaylist(vod), true);
});

test('rewriteHlsPlaylistToLocal strips expiring upstream URLs into canonical /smartcache/v1/hls/<key>/ paths', () => {
  const vod = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-MAP:URI="init.mp4?sig=secret1"',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k1?sig=secret2"',
    '#EXTINF:4.0,',
    'seg-001.ts?sig=secret3',
    '#EXTINF:4.0,',
    'seg-002.ts?sig=secret4',
    '#EXT-X-ENDLIST',
  ].join('\n');

  const result = rewriteHlsPlaylistToLocal(
    vod,
    'https://cdn.example.com/vod/mid/index.m3u8',
    'sc-vod99',
  );

  assert.equal(result.assetsToCache.length, 4);
  assert.ok(result.rewrittenManifest.includes('URI="/smartcache/v1/hls/sc-vod99/init-0"'));
  assert.ok(result.rewrittenManifest.includes('URI="/smartcache/v1/hls/sc-vod99/key-0"'));
  assert.ok(result.rewrittenManifest.includes('/smartcache/v1/hls/sc-vod99/seg-0'));
  assert.ok(result.rewrittenManifest.includes('/smartcache/v1/hls/sc-vod99/seg-1'));
  assert.equal(result.rewrittenManifest.includes('sig='), false);
});
