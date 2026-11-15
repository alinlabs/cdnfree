import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCleanUrQueryValue,
  formatCleanUrl,
} from '../../src/utils/clean-url.ts';

test('formatCleanUrl strips https://, www., and trailing root slash when no path or params exist', () => {
  assert.equal(formatCleanUrl('https://www.alvareza.my.id/'), 'alvareza.my.id');
  assert.equal(formatCleanUrl('https://www.alvareza.my.id'), 'alvareza.my.id');
  assert.equal(formatCleanUrl('https://alvareza.my.id/'), 'alvareza.my.id');
  assert.equal(formatCleanUrl('https://WWW.Example.COM/'), 'example.com');
});

test('formatCleanUrl preserves path, query, hash, port, and plain http protocol', () => {
  assert.equal(
    formatCleanUrl('https://www.alvareza.my.id/profile-me'),
    'alvareza.my.id/profile-me',
  );
  assert.equal(
    formatCleanUrl('https://www.alvareza.my.id/profile-me?tab=bio#top'),
    'alvareza.my.id/profile-me?tab=bio#top',
  );
  assert.equal(
    formatCleanUrl('https://www.example.com:8443/'),
    'example.com:8443',
  );
  assert.equal(
    formatCleanUrl('http://www.example.com/'),
    'http://example.com',
  );
  assert.equal(
    formatCleanUrl('http://www.example.com/', { stripHttp: true }),
    'example.com',
  );
});

test('formatCleanUrl avoids stripping www when domain is www.com and redacts sensitive params when requested', () => {
  assert.equal(formatCleanUrl('https://www.com/'), 'www.com');
  assert.equal(
    formatCleanUrl('https://www.alvareza.my.id/callback?token=secret123&view=1', {
      redactSensitive: true,
    }),
    'alvareza.my.id/callback?token=REDACTED&view=1',
  );
});

test('encodeCleanUrQueryValue preserves slashes cleanly while safely encoding special query chars', () => {
  assert.equal(
    encodeCleanUrQueryValue('https://www.alvareza.my.id/'),
    'alvareza.my.id',
  );
  assert.equal(
    encodeCleanUrQueryValue('https://www.alvareza.my.id/profile-me'),
    'alvareza.my.id/profile-me',
  );
  assert.equal(
    encodeCleanUrQueryValue('https://www.alvareza.my.id/a?x=1&y=2'),
    'alvareza.my.id/a%3Fx%3D1%26y%3D2',
  );
});
