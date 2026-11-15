import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaRangeHeaders,
  parseHttpByteRange,
} from '../../src/utils/sw-range-parser.ts';

test('parseHttpByteRange handles full, open-ended, closed, suffix, and invalid ranges', () => {
  assert.deepEqual(parseHttpByteRange(null, 1000), { type: 'full' });

  assert.deepEqual(parseHttpByteRange('bytes=0-', 1000), {
    type: 'partial',
    start: 0,
    end: 999,
    totalBytes: 1000,
  });

  assert.deepEqual(parseHttpByteRange('bytes=100-249', 1000), {
    type: 'partial',
    start: 100,
    end: 249,
    totalBytes: 1000,
  });

  // Clamps end to totalBytes - 1
  assert.deepEqual(parseHttpByteRange('bytes=900-5000', 1000), {
    type: 'partial',
    start: 900,
    end: 999,
    totalBytes: 1000,
  });

  // Suffix range bytes=-200
  assert.deepEqual(parseHttpByteRange('bytes=-200', 1000), {
    type: 'partial',
    start: 800,
    end: 999,
    totalBytes: 1000,
  });

  // Unsatisfiable 416 cases
  assert.deepEqual(parseHttpByteRange('bytes=1000-1100', 1000), {
    type: 'unsatisfiable',
    totalBytes: 1000,
  });
  assert.deepEqual(parseHttpByteRange('bytes=500-100', 1000), {
    type: 'unsatisfiable',
    totalBytes: 1000,
  });
  assert.deepEqual(parseHttpByteRange('items=0-10', 1000), {
    type: 'unsatisfiable',
    totalBytes: 1000,
  });
});

test('buildMediaRangeHeaders constructs 206, 200, and 416 headers properly', () => {
  const r206 = parseHttpByteRange('bytes=10-19', 100);
  const h206 = buildMediaRangeHeaders('video/mp4', 100, r206);
  assert.equal(h206['Content-Type'], 'video/mp4');
  assert.equal(h206['Content-Range'], 'bytes 10-19/100');
  assert.equal(h206['Content-Length'], '10');
  assert.equal(h206['Accept-Ranges'], 'bytes');
  assert.equal(h206['X-CDNFREE-Cache'], 'HIT');

  const r416 = parseHttpByteRange('bytes=500-', 100);
  const h416 = buildMediaRangeHeaders('video/mp4', 100, r416);
  assert.equal(h416['Content-Range'], 'bytes */100');
});
