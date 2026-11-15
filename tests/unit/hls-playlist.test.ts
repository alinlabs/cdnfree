import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaylistContext,
  decodeHlsChildUrl,
  listSegments,
  parseExpiry,
  rewritePlaylist,
} from '../../server/services/hls-playlist.ts';

test('rewritePlaylist rewrites segment lines and URI="..." attributes while inheriting same-origin token queries', () => {
  const playlistUrl =
    'https://api.tvid.app/v1/hls/master.m3u8?token=abc123&sess=xyz999';
  const ctx = buildPlaylistContext(
    '11111111-1111-4111-8111-111111111111',
    'hls-1',
    playlistUrl,
    playlistUrl,
  );

  const raw = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-KEY:METHOD=AES-128,URI="/keys/k1.key"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1200000',
    '720p/index.m3u8',
    'seg-001.ts',
    'https://other-cdn.example.net/seg-002.ts',
  ].join('\n');

  const out = rewritePlaylist(raw, ctx);
  const matches = [...out.matchAll(/\/api\/hls\/[^/]+\/hls-1\?u=([^"'\s]+)/g)];
  assert.equal(matches.length, 5);

  const decoded = matches.map((m) => decodeHlsChildUrl(decodeURIComponent(m[1])));
  assert.equal(
    decoded[0],
    'https://api.tvid.app/v1/hls/init.mp4?token=abc123&sess=xyz999',
  );
  assert.equal(
    decoded[1],
    'https://api.tvid.app/keys/k1.key?token=abc123&sess=xyz999',
  );
  assert.equal(
    decoded[2],
    'https://api.tvid.app/v1/hls/720p/index.m3u8?token=abc123&sess=xyz999',
  );
  assert.equal(
    decoded[3],
    'https://api.tvid.app/v1/hls/seg-001.ts?token=abc123&sess=xyz999',
  );
  // Cross-origin URI must NEVER receive token query from api.tvid.app
  assert.equal(decoded[4], 'https://other-cdn.example.net/seg-002.ts');
});

test('listSegments parses variants sorted descending and separates init/media segments', () => {
  const ctx = buildPlaylistContext(
    '11111111-1111-4111-8111-111111111111',
    'hls-1',
    'https://cdn.example.com/live/master.m3u8?auth=sig',
  );

  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000',
    'low.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2400000',
    'high.m3u8',
  ].join('\n');

  const parsedMaster = listSegments(master, ctx);
  assert.equal(parsedMaster.isMaster, true);
  assert.equal(parsedMaster.variants.length, 2);
  assert.equal(parsedMaster.variants[0].bandwidth, 2400000);
  assert.equal(
    parsedMaster.variants[0].url,
    'https://cdn.example.com/live/high.m3u8?auth=sig',
  );

  const media = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:4.0,',
    'part0.m4s',
    '#EXTINF:4.0,',
    'part1.m4s',
  ].join('\n');

  const parsedMedia = listSegments(media, ctx);
  assert.equal(parsedMedia.isMaster, false);
  assert.deepEqual(parsedMedia.initSegments, [
    'https://cdn.example.com/live/init.mp4?auth=sig',
  ]);
  assert.deepEqual(parsedMedia.segments, [
    'https://cdn.example.com/live/part0.m4s?auth=sig',
    'https://cdn.example.com/live/part1.m4s?auth=sig',
  ]);
});

test('parseExpiry normalizes second and millisecond epoch query parameters', () => {
  assert.equal(parseExpiry('https://cdn.example/p.m3u8?exp=1893456000'), 1893456000);
  assert.equal(parseExpiry('https://cdn.example/p.m3u8?expires=1893456000000'), 1893456000);
  assert.equal(parseExpiry('https://cdn.example/p.m3u8?token=abc'), null);
});
