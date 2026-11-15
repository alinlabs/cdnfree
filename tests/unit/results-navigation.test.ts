import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPreservedResultsRoutePath,
  buildResultsRoutePath,
  resolveResultsTabFromPathname,
  shouldShowWebBackButton,
} from '../../src/pages/hasil-pencarian/shared/results-navigation.ts';

test('resolveResultsTabFromPathname maps /search and legacy /hasil-pencarian tabs, and rejects unknown subpaths', () => {
  assert.equal(resolveResultsTabFromPathname('/search'), 'web');
  assert.equal(resolveResultsTabFromPathname('/search/'), 'web');
  assert.equal(resolveResultsTabFromPathname('/search/web'), 'web');
  assert.equal(resolveResultsTabFromPathname('/search/detail'), 'detail');
  assert.equal(resolveResultsTabFromPathname('/search/detail/'), 'detail');
  assert.equal(resolveResultsTabFromPathname('/search/aset'), 'aset');
  assert.equal(resolveResultsTabFromPathname('/search/unknown'), null);

  assert.equal(resolveResultsTabFromPathname('/hasil-pencarian'), 'web');
  assert.equal(resolveResultsTabFromPathname('/hasil-pencarian/'), 'web');
  assert.equal(resolveResultsTabFromPathname('/hasil-pencarian/web'), 'web');
  assert.equal(resolveResultsTabFromPathname('/hasil-pencarian/detail'), 'detail');
  assert.equal(resolveResultsTabFromPathname('/hasil-pencarian/aset'), 'aset');
  assert.equal(resolveResultsTabFromPathname('/hasil-pencarian/ringkasan'), null);
});

test('buildResultsRoutePath constructs clean /search routes with ur parameter without protocol, www, or trailing root slash', () => {
  assert.equal(buildResultsRoutePath('web'), '/search');
  assert.equal(buildResultsRoutePath('detail'), '/search/detail');
  assert.equal(buildResultsRoutePath('aset'), '/search/aset');

  assert.equal(
    buildResultsRoutePath('web', {
      url: 'https://www.alvareza.my.id/',
      id: 'insp-42',
    }),
    '/search?ur=alvareza.my.id',
  );

  assert.equal(
    buildResultsRoutePath('web', {
      url: 'https://www.alvareza.my.id/profile-me',
    }),
    '/search?ur=alvareza.my.id/profile-me',
  );

  assert.equal(
    buildResultsRoutePath('detail', {
      url: 'https://www.example.com/a?x=1',
      id: 'insp-42',
      includeId: true,
    }),
    '/search/detail?ur=example.com/a%3Fx%3D1&id=insp-42',
  );

  assert.equal(
    buildResultsRoutePath('aset', { url: 'https://example.com/' }),
    '/search/aset?ur=example.com',
  );

  assert.equal(
    buildResultsRoutePath('aset', {
      url: 'https://www.example.com/gallery/',
      q: 'hero',
      jenis: 'image',
      status: 'allowed',
      view: 'image',
      item: 'asset-99',
    }),
    '/search/aset?ur=example.com/gallery/&q=hero&jenis=image&status=allowed&view=image&item=asset-99',
  );

  assert.equal(
    buildResultsRoutePath('aset', {
      url: 'https://example.com/',
      q: '',
      jenis: 'all',
      status: 'all',
      view: 'image',
      item: null,
    }),
    '/search/aset?ur=example.com',
  );

  assert.equal(
    buildResultsRoutePath('aset', {
      bulkId: 'ab12cd34',
      jenis: 'image',
      fmt: ['jpg', 'svg'],
      q: 'logo',
    }),
    '/search/aset?bulk=ab12cd34&q=logo&jenis=image&fmt=jpg,svg',
  );
});

test('shouldShowWebBackButton hides back icon on bulk or direct asset/detail without web origin', () => {
  assert.equal(
    shouldShowWebBackButton({ activeTab: 'web', isBulkMode: false, canReturnToWeb: true }),
    false,
  );
  assert.equal(
    shouldShowWebBackButton({ activeTab: 'aset', isBulkMode: true, canReturnToWeb: false }),
    false,
  );
  assert.equal(
    shouldShowWebBackButton({ activeTab: 'aset', isBulkMode: true, canReturnToWeb: true }),
    false,
  );
  assert.equal(
    shouldShowWebBackButton({ activeTab: 'aset', isBulkMode: false, canReturnToWeb: false }),
    false,
  );
  assert.equal(
    shouldShowWebBackButton({ activeTab: 'detail', isBulkMode: false, canReturnToWeb: false }),
    false,
  );
  assert.equal(
    shouldShowWebBackButton({ activeTab: 'aset', isBulkMode: false, canReturnToWeb: true }),
    true,
  );
  assert.equal(
    shouldShowWebBackButton({ activeTab: 'detail', isBulkMode: false, canReturnToWeb: true }),
    true,
  );
});

test('buildPreservedResultsRoutePath keeps aset filters on URL canonicalization', () => {
  assert.equal(
    buildPreservedResultsRoutePath(
      'aset',
      'https://final.example.com/media',
      '?ur=short.link&jenis=video&fmt=mp4&q=trailer&status=allowed',
    ),
    '/search/aset?ur=final.example.com/media&q=trailer&jenis=video&fmt=mp4&status=allowed',
  );
  assert.equal(
    buildPreservedResultsRoutePath(
      'web',
      'https://final.example.com/',
      '?ur=short.link&jenis=video',
    ),
    '/search?ur=final.example.com',
  );
});


