import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRouteTitle,
  isRouteActive,
  shouldShowGlobalNav,
} from '../../src/utils/route-meta';

test('getRouteTitle resolves all CDNFREE routes and fallback', () => {
  assert.equal(
    getRouteTitle('/'),
    'CDNFREE — Inspeksi Tautan & Penjelajahan Lebih Aman',
  );
  assert.equal(getRouteTitle('/search'), 'Hasil Inspeksi — CDNFREE');
  assert.equal(
    getRouteTitle('/search/web'),
    'Tampilan Web — Hasil Inspeksi — CDNFREE',
  );
  assert.equal(
    getRouteTitle('/search/detail'),
    'Detail Inspeksi — CDNFREE',
  );
  assert.equal(
    getRouteTitle('/search/aset'),
    'Aset Manager — CDNFREE',
  );
  assert.equal(getRouteTitle('/hasil-pencarian'), 'Hasil Inspeksi — CDNFREE');
  assert.equal(
    getRouteTitle('/hasil-pencarian/web'),
    'Tampilan Web — Hasil Inspeksi — CDNFREE',
  );
  assert.equal(
    getRouteTitle('/hasil-pencarian/detail'),
    'Detail Inspeksi — CDNFREE',
  );
  assert.equal(
    getRouteTitle('/hasil-pencarian/aset'),
    'Aset Manager — CDNFREE',
  );
  assert.equal(
    getRouteTitle('/riwayat-pencarian'),
    'Riwayat Pencarian — CDNFREE',
  );
  assert.equal(getRouteTitle('/riwayat-pencarian/'), 'Riwayat Pencarian — CDNFREE');
  assert.equal(getRouteTitle('/markah'), 'Markah Media — CDNFREE');
  assert.equal(getRouteTitle('/markah/'), 'Markah Media — CDNFREE');
  assert.equal(getRouteTitle('/pengaturan'), 'Pengaturan — CDNFREE');
  assert.equal(
    getRouteTitle('/rute-tidak-dikenal'),
    'Halaman Tidak Ditemukan — CDNFREE',
  );
});

test('isRouteActive handles root and nested paths accurately', () => {
  assert.equal(isRouteActive('/', '/'), true);
  assert.equal(isRouteActive('/pengaturan', '/'), false);
  assert.equal(isRouteActive('/pengaturan', '/pengaturan'), true);
  assert.equal(isRouteActive('/markah', '/markah'), true);
  assert.equal(isRouteActive('/markah', '/pengaturan'), false);
  assert.equal(isRouteActive('/riwayat-pencarian', '/riwayat-pencarian'), true);
  assert.equal(isRouteActive('/search', '/riwayat-pencarian'), false);
  assert.equal(isRouteActive('/search/detail', '/search'), true);
  assert.equal(isRouteActive('/hasil-pencarian', '/riwayat-pencarian'), false);
  assert.equal(isRouteActive('/hasil-pencarian/detail', '/hasil-pencarian'), true);
});

test('shouldShowGlobalNav hides global header/bottom nav on /search and /hasil-pencarian only', () => {
  assert.equal(shouldShowGlobalNav('/'), true);
  assert.equal(shouldShowGlobalNav('/riwayat-pencarian'), true);
  assert.equal(shouldShowGlobalNav('/markah'), true);
  assert.equal(shouldShowGlobalNav('/pengaturan'), true);
  assert.equal(shouldShowGlobalNav('/rute-tidak-dikenal'), true);
  assert.equal(shouldShowGlobalNav('/search'), false);
  assert.equal(shouldShowGlobalNav('/search/'), false);
  assert.equal(shouldShowGlobalNav('/search/web'), false);
  assert.equal(shouldShowGlobalNav('/search/detail'), false);
  assert.equal(shouldShowGlobalNav('/search/aset'), false);
  assert.equal(shouldShowGlobalNav('/hasil-pencarian'), false);
  assert.equal(shouldShowGlobalNav('/hasil-pencarian/'), false);
  assert.equal(shouldShowGlobalNav('/hasil-pencarian/web'), false);
  assert.equal(shouldShowGlobalNav('/hasil-pencarian/detail'), false);
  assert.equal(shouldShowGlobalNav('/hasil-pencarian/aset'), false);
});
