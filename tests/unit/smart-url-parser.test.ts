import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractUrlsFromInput,
  parseSingleSearchInput,
} from '../../src/utils/smart-url-parser.ts';

test('extractUrlsFromInput repairs space-separated extensions and ignores surrounding noise words', () => {
  const res = extractUrlsFromInput('https://alvareza.com/video .mp4 dd');
  assert.deepEqual(res.validUrls, ['https://alvareza.com/video.mp4']);
  assert.equal(res.rejectedCandidates.length, 0);
  assert.ok(res.ignoredNoiseCount >= 1);

  const spacedDeep = extractUrlsFromInput(
    'cek link https : // alvareza . com / assets / hero . png mantap bos // ini komentar',
  );
  assert.deepEqual(spacedDeep.validUrls, [
    'https://alvareza.com/assets/hero.png',
  ]);

  const spacedQuery = extractUrlsFromInput(
    'https://alvareza.com/watch ? v = abc123 & hd = 1 ya',
  );
  assert.deepEqual(spacedQuery.validUrls, [
    'https://alvareza.com/watch?v=abc123&hd=1',
  ]);
});

test('extractUrlsFromInput splits glued/concatenated URLs accurately without breaking query redirect params', () => {
  const glued = extractUrlsFromInput(
    'https://alvareza.com/video.mp4https://alvareza.com/video.mp5',
  );
  assert.deepEqual(glued.validUrls, [
    'https://alvareza.com/video.mp4',
    'https://alvareza.com/video.mp5',
  ]);

  const gluedBareSecond = extractUrlsFromInput(
    'https://alvareza.com/video.mp4alvareza.com/video.mp5',
  );
  assert.deepEqual(gluedBareSecond.validUrls, [
    'https://alvareza.com/video.mp4',
    'https://alvareza.com/video.mp5',
  ]);

  const nestedRedirectAndGlued = extractUrlsFromInput(
    'https://a.example.com/go?next=https://b.example.com/clip.mp4https://c.example.com/other.mp4',
  );
  assert.deepEqual(nestedRedirectAndGlued.validUrls, [
    'https://a.example.com/go?next=https://b.example.com/clip.mp4',
    'https://c.example.com/other.mp4',
  ]);
});

test('extractUrlsFromInput handles markdown, HTML quotes, defanged links, balanced parens, and mixed bulk notes', () => {
  const mixed = extractUrlsFromInput(`
    ini daftar tautan dari catatan:
    1) [Hero](https://cdn.example.org/banner.webp)
    2) "hxxps://media[.]example[.]org/video .mp4" dd
    3) https://en.wikipedia.org/wiki/Type_(biology).
    4) contoh.com/halaman , situslain.net/galeri
  `);
  assert.deepEqual(mixed.validUrls, [
    'https://cdn.example.org/banner.webp',
    'https://media.example.org/video.mp4',
    'https://en.wikipedia.org/wiki/Type_(biology)',
    'https://contoh.com/halaman',
    'https://situslain.net/galeri',
  ]);
  assert.equal(mixed.rejectedCandidates.length, 0);
});

test('extractUrlsFromInput ignores plain prose & standalone filenames while still blocking prohibited/unsafe URLs', () => {
  const proseOnly = extractUrlsFromInput(
    'halo apa kabar tolong cek video.mp4 dan foto.png ya',
  );
  assert.deepEqual(proseOnly.validUrls, []);
  assert.equal(proseOnly.rejectedCandidates.length, 0);

  const prohibited = extractUrlsFromInput(
    'http://localhost:3000 http://127.0.0.1 javascript:alert(1)',
  );
  assert.deepEqual(prohibited.validUrls, []);
  assert.equal(prohibited.rejectedCandidates.length, 3);
  assert.equal(prohibited.rejectedCandidates[0].reason, 'PROHIBITED_HOST');
  assert.equal(prohibited.rejectedCandidates[1].reason, 'PROHIBITED_HOST');
  assert.equal(prohibited.rejectedCandidates[2].reason, 'UNSUPPORTED_SCHEME');
});

test('parseSingleSearchInput resolves messy single links and reports count on glued multi-links', () => {
  const repaired = parseSingleSearchInput('  https://alvareza.com/video .mp4 dd  ');
  assert.equal(repaired.outcome.ok, true);
  assert.equal(repaired.hadRepairsOrNoise, true);
  assert.equal(repaired.extractedCount, 1);
  if (repaired.outcome.ok) {
    assert.equal(repaired.outcome.normalizedUrl, 'https://alvareza.com/video.mp4');
  }

  const glued = parseSingleSearchInput(
    'https://alvareza.com/video.mp4https://alvareza.com/video.mp5',
  );
  assert.equal(glued.outcome.ok, true);
  assert.equal(glued.extractedCount, 2);
  assert.equal(glued.hadRepairsOrNoise, true);
  assert.deepEqual(glued.allValidUrls, [
    'https://alvareza.com/video.mp4',
    'https://alvareza.com/video.mp5',
  ]);

  const clean = parseSingleSearchInput('https://alvareza.com/video.mp4');
  assert.equal(clean.outcome.ok, true);
  assert.equal(clean.hadRepairsOrNoise, false);

  const rejected = parseSingleSearchInput('http://localhost:8080/admin');
  assert.equal(rejected.outcome.ok, false);
  if (!rejected.outcome.ok) {
    assert.equal(rejected.outcome.reason, 'PROHIBITED_HOST');
  }
});
