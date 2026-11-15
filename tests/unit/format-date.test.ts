import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTimestampId } from '../../src/utils/format-date';

test('formatTimestampId formats timestamps as HH:mm, D MMM YYYY in Indonesian short months', () => {
  assert.equal(
    formatTimestampId('2026-12-06T22:00:00.000Z', { utc: true }),
    '22:00, 6 Des 2026',
  );
  assert.equal(
    formatTimestampId('2026-11-16T02:12:00.000Z', { utc: true }),
    '02:12, 16 Nov 2026',
  );
  assert.equal(
    formatTimestampId('2026-05-09T09:05:00.000Z', { utc: true }),
    '09:05, 9 Mei 2026',
  );
  assert.equal(
    formatTimestampId('2026-08-17T14:30:00.000Z', { utc: true }),
    '14:30, 17 Agu 2026',
  );
  assert.equal(formatTimestampId('not-a-date'), 'Waktu tidak diketahui');
});
