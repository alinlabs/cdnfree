import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffKind, refineMime } from '../../server/services/content-sniff.ts';
import { reconcile } from '../../server/services/reconcile.ts';
import { unescapeUrlText } from '../../server/services/unescape-url.ts';
import { parseTotalBytes } from '../../server/services/fetch-head-bytes.ts';

test('sniffKind distinguishes HTML wrapper pretending to be .mp4 from real MP4 ftyp', () => {
  assert.equal(sniffKind(Buffer.from('<!DOCTYPE html><html><body>fake</body></html>')), 'html');
  assert.equal(sniffKind(Buffer.from('   \n\t<script>location.href="x"</script>')), 'html');

  const mp4Ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
  ]);
  assert.equal(sniffKind(mp4Ftyp), 'video');
  assert.equal(refineMime('video', mp4Ftyp), 'video/mp4');
});

test('sniffKind detects HLS, DASH, WebM, JPEG, PNG, SVG, PDF, and leaked gzip archive', () => {
  assert.equal(sniffKind(Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n')), 'hls');
  assert.equal(sniffKind(Buffer.from('<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011">')), 'dash');
  assert.equal(sniffKind(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86])), 'video');
  assert.equal(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image');
  assert.equal(sniffKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'image');
  assert.equal(sniffKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image');
  assert.equal(sniffKind(Buffer.from('%PDF-1.7\n')), 'pdf');
  assert.equal(sniffKind(Buffer.from([0x1f, 0x8b, 0x08, 0x00])), 'archive');
  assert.equal(sniffKind(Buffer.alloc(0)), 'empty');
});

test('reconcile flags wrapper when HTML body pretends to be media by header or .mp4 extension', () => {
  const headerWrapper = reconcile('video/mp4', 'html', 'https://cdn.example/video');
  assert.equal(headerWrapper.kind, 'html');
  assert.equal(headerWrapper.wrapper, true);

  const extWrapper = reconcile('text/html; charset=utf-8', 'html', 'https://cdn2.eciemg.com/2llRtZ4T1.mp4');
  assert.equal(extWrapper.kind, 'html');
  assert.equal(extWrapper.wrapper, true);

  const regularHtml = reconcile('text/html; charset=utf-8', 'html', 'https://example.com/watch');
  assert.equal(regularHtml.kind, 'html');
  assert.equal(regularHtml.wrapper, false);
});

test('unescapeUrlText preserves HLS signed query delimiters', () => {
  const raw = 'https:\\/\\/api.tvid.app\\/hls\\/master.m3u8\\u003ftoken\\u003dabc\\u0026sess\\u003dxyz&amp;expires_at=1900000000\\x26v=1';
  assert.equal(
    unescapeUrlText(raw),
    'https://api.tvid.app/hls/master.m3u8?token=abc&sess=xyz&expires_at=1900000000&v=1',
  );
});

test('parseTotalBytes prefers full size from Content-Range over partial Content-Length', () => {
  assert.equal(parseTotalBytes('bytes 0-2047/146681790', '2048'), 146681790);
  assert.equal(parseTotalBytes('bytes 0-2047/*', '2048'), null);
  assert.equal(parseTotalBytes(null, '21976699'), 21976699);
});
