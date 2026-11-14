import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaSubtitleMeta,
  clampMediaIndex,
  clampMediaPan,
  clampMediaZoom,
  formatMediaTime,
  getNextMediaIndex,
  getNextPlaybackSpeed,
  getPrevMediaIndex,
  getVideoErrorCopy,
  mapVideoMediaError,
  MEDIA_MAX_ZOOM,
  MEDIA_MIN_ZOOM,
  stepMediaZoom,
} from '../../src/pages/hasil-pencarian/media-player/media-player-utils.ts';

test('media index helpers clamp and wrap cleanly across empty, single, and multi-item collections', () => {
  assert.equal(clampMediaIndex(-3, 5), 0);
  assert.equal(clampMediaIndex(9, 5), 4);
  assert.equal(clampMediaIndex(2, 0), 0);

  assert.equal(getPrevMediaIndex(0, 4), 3);
  assert.equal(getNextMediaIndex(3, 4), 0);
  assert.equal(getPrevMediaIndex(0, 1), 0);
  assert.equal(getNextMediaIndex(0, 1), 0);
});

test('formatMediaTime and getNextPlaybackSpeed handle edge cases', () => {
  assert.equal(formatMediaTime(NaN), '00:00');
  assert.equal(formatMediaTime(-5), '00:00');
  assert.equal(formatMediaTime(65), '01:05');
  assert.equal(formatMediaTime(3661), '1:01:01');

  assert.equal(getNextPlaybackSpeed(0.5), 1);
  assert.equal(getNextPlaybackSpeed(1), 1.25);
  assert.equal(getNextPlaybackSpeed(2), 0.5);
  assert.equal(getNextPlaybackSpeed(99), 1);
});

test('media zoom and pan helpers clamp bounds cleanly for full view and fullscreen stages', () => {
  assert.equal(clampMediaZoom(0.1), MEDIA_MIN_ZOOM);
  assert.equal(clampMediaZoom(8), MEDIA_MAX_ZOOM);
  assert.equal(clampMediaZoom(Number.NaN), 1);
  assert.equal(stepMediaZoom(1, 0.25), 1.25);
  assert.equal(stepMediaZoom(0.6, -0.25), MEDIA_MIN_ZOOM);

  assert.deepEqual(
    clampMediaPan({ x: 120, y: -90 }, 1, { width: 800, height: 600 }),
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    clampMediaPan({ x: 600, y: -500 }, 2, { width: 800, height: 600 }),
    { x: 400, y: -300 },
  );
  assert.deepEqual(
    clampMediaPan({ x: 150, y: -120 }, 2, { width: 800, height: 600 }),
    { x: 150, y: -120 },
  );
});

test('buildMediaSubtitleMeta formats host, MIME/format, byte size, counter, and optional status', () => {
  assert.equal(
    buildMediaSubtitleMeta({
      host: 'www.iana.org',
      formatLabel: 'SVG',
      declaredBytes: 2048,
      index: 0,
      total: 1,
    }),
    'www.iana.org · SVG · 2,0 KB',
  );

  assert.equal(
    buildMediaSubtitleMeta({
      host: 'cdn.example.com',
      formatLabel: 'video/mp4',
      declaredBytes: undefined,
      index: 1,
      total: 4,
      statusMessage: 'Tersimpan (12 KB)',
    }),
    'cdn.example.com · video/mp4 · Ukuran tidak diketahui · 2 / 4 · Tersimpan (12 KB)',
  );
});

test('mapVideoMediaError and getVideoErrorCopy differentiate network, decode, and src errors', () => {
  assert.equal(mapVideoMediaError(2), 'network');
  assert.equal(mapVideoMediaError(3), 'decode');
  assert.equal(mapVideoMediaError(4), 'src');
  assert.equal(mapVideoMediaError(undefined), 'unknown');

  const netCopy = getVideoErrorCopy('network', 'video/mp4', false);
  assert.ok(netCopy.title.includes('Koneksi ke sumber terputus'));

  const decodeCopy = getVideoErrorCopy('decode', 'video/mp4', false);
  assert.ok(decodeCopy.title.includes('Dekode'));

  const srcProxyCopy = getVideoErrorCopy('src', 'video/mp4', false);
  assert.ok(srcProxyCopy.description.includes('Putar langsung'));

  const srcDirectCopy = getVideoErrorCopy('src', 'video/mp4', true);
  assert.equal(srcDirectCopy.description.includes('Putar langsung'), false);
});
