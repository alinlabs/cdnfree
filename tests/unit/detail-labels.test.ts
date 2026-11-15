import test from 'node:test';
import assert from 'node:assert/strict';
import type { LinkRecord } from '../../src/types/inspection.ts';
import {
  filterPageLinks,
  getLinkClassificationBadge,
  getMetaRefreshSummary,
} from '../../src/pages/hasil-pencarian/detail/detail-labels.ts';

function makeLink(overrides: Partial<LinkRecord>): LinkRecord {
  return {
    id: 'lnk-1',
    href: 'https://example.com/docs',
    host: 'example.com',
    text: 'Dokumentasi',
    classification: 'ordinary',
    ...overrides,
  };
}

test('getLinkClassificationBadge returns distinct Indonesian labels for each classification', () => {
  assert.equal(getLinkClassificationBadge('known-malicious').text, 'Diketahui berbahaya');
  assert.equal(getLinkClassificationBadge('suspicious').text, 'Perlu ditinjau');
  assert.equal(
    getLinkClassificationBadge('ad-or-tracker').text,
    'Cocok daftar filter (iklan/pelacak)',
  );
  assert.equal(getLinkClassificationBadge('unknown').text, 'Tidak diketahui');
  assert.equal(getLinkClassificationBadge('ordinary').text, 'Tautan biasa');
});

test('filterPageLinks filters by review status and query across href, host, and text', () => {
  const links: LinkRecord[] = [
    makeLink({ id: '1', text: 'Beranda', classification: 'ordinary' }),
    makeLink({
      id: '2',
      href: 'https://promo.tracker/click',
      host: 'promo.tracker',
      text: 'Iklan',
      classification: 'ad-or-tracker',
    }),
    makeLink({
      id: '3',
      href: 'https://bit.ly/abc',
      host: 'bit.ly',
      text: 'Unduh cepat',
      classification: 'suspicious',
    }),
    makeLink({
      id: '4',
      href: 'https://phish.example/login',
      host: 'phish.example',
      text: 'Masuk',
      classification: 'known-malicious',
    }),
  ];

  assert.deepEqual(
    filterPageLinks(links, '', 'review').map((l) => l.id),
    ['3', '4'],
  );
  assert.deepEqual(
    filterPageLinks(links, 'bit.ly', 'all').map((l) => l.id),
    ['3'],
  );
  assert.deepEqual(
    filterPageLinks(links, 'iklan', 'ad-or-tracker').map((l) => l.id),
    ['2'],
  );
});

test('getMetaRefreshSummary redacts tokens and formats optional delay', () => {
  assert.equal(
    getMetaRefreshSummary({
      targetUrl: 'https://example.com/next?token=secret123',
      delaySeconds: 5,
      rawContent: '5;url=https://example.com/next?token=secret123',
    }),
    'Menunjuk ke https://example.com/next?token=REDACTED (jeda 5 detik)',
  );
  assert.equal(
    getMetaRefreshSummary({
      targetUrl: undefined,
      rawContent: '0;url=javascript:alert(1)',
    }),
    'Target meta refresh tidak valid atau ditolak kebijakan keamanan.',
  );
});
