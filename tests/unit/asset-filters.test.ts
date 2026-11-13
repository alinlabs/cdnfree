import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResourceRecord } from '../../src/types/inspection.ts';
import {
  filterInspectionResources,
  parseAssetKindFilter,
  parseAssetStatusFilter,
  parseMediaFullViewParams,
  partitionAssetsByCategory,
  resolveFullViewIndex,
} from '../../src/pages/hasil-pencarian/aset/asset-filters.ts';

function makeResource(overrides: Partial<ResourceRecord>): ResourceRecord {
  return {
    id: 'res-1',
    url: 'https://cdn.example.com/asset.bin',
    host: 'cdn.example.com',
    kind: 'other',
    source: 'html-link',
    observation: 'discovered',
    classification: 'allowed',
    ...overrides,
  };
}

test('filterInspectionResources filters by kind, classification status, and search query', () => {
  const resources: ResourceRecord[] = [
    makeResource({
      id: 'img-1',
      url: 'https://cdn.example.com/hero.webp',
      kind: 'image',
      mimeType: 'image/webp',
      classification: 'allowed',
    }),
    makeResource({
      id: 'trk-1',
      url: 'https://tracker.ads/pixel.js',
      host: 'tracker.ads',
      kind: 'script',
      mimeType: 'application/javascript',
      classification: 'ad-or-tracker',
    }),
    makeResource({
      id: 'mal-1',
      url: 'https://bad.example/payload.js',
      host: 'bad.example',
      kind: 'script',
      classification: 'known-malicious',
    }),
  ];

  assert.equal(filterInspectionResources(resources, '', 'all', 'all').length, 3);
  assert.equal(filterInspectionResources(resources, '', 'image', 'all').length, 1);
  assert.deepEqual(
    filterInspectionResources(resources, '', 'all', 'all', ['webp']).map((r) => r.id),
    ['img-1'],
  );
  assert.deepEqual(
    filterInspectionResources(resources, '', 'all', 'all', ['js']).map((r) => r.id),
    ['trk-1', 'mal-1'],
  );
  assert.deepEqual(
    filterInspectionResources(resources, '', 'all', 'suspicious').map((r) => r.id),
    ['mal-1'],
  );
  assert.deepEqual(
    filterInspectionResources(resources, 'pixel', 'script', 'ad-or-tracker').map(
      (r) => r.id,
    ),
    ['trk-1'],
  );
});

test('partitionAssetsByCategory separates images, videos, PDFs, and other assets accurately', () => {
  const partitioned = partitionAssetsByCategory([
    makeResource({ id: 'img', kind: 'image', url: 'https://cdn.example.com/a.png' }),
    makeResource({
      id: 'vid',
      kind: 'video',
      url: 'https://cdn.example.com/v.mp4',
      mimeType: 'video/mp4',
    }),
    makeResource({
      id: 'pdf',
      kind: 'document',
      url: 'https://cdn.example.com/manual.pdf',
      mimeType: 'application/pdf',
    }),
    makeResource({
      id: 'css',
      kind: 'stylesheet',
      url: 'https://cdn.example.com/app.css',
      mimeType: 'text/css',
    }),
  ]);

  assert.deepEqual(partitioned.imageAssets.map((r) => r.id), ['img']);
  assert.deepEqual(partitioned.videoAssets.map((r) => r.id), ['vid']);
  assert.deepEqual(partitioned.pdfAssets.map((r) => r.id), ['pdf']);
  assert.deepEqual(partitioned.otherAssets.map((r) => r.id), ['css']);
});

test('URL asset filter and full-view query helpers parse and resolve items safely', () => {
  assert.equal(parseAssetKindFilter('image'), 'image');
  assert.equal(parseAssetKindFilter('invalid'), 'all');
  assert.equal(parseAssetKindFilter(null), 'all');

  assert.equal(parseAssetStatusFilter('suspicious'), 'suspicious');
  assert.equal(parseAssetStatusFilter('nope'), 'all');

  assert.deepEqual(parseMediaFullViewParams('image', 'img-2'), {
    kind: 'image',
    itemKey: 'img-2',
  });
  assert.equal(parseMediaFullViewParams('pdf', 'doc-1'), null);
  assert.equal(parseMediaFullViewParams('image', '   '), null);

  const images = [
    makeResource({ id: 'hash-a', kind: 'image', url: 'https://cdn.example.com/hero.png' }),
    makeResource({ id: 'hash-b', kind: 'image', url: 'https://cdn.example.com/logo.svg' }),
  ];
  assert.equal(resolveFullViewIndex([], 'hash-a'), -1);
  assert.equal(resolveFullViewIndex(images, 'hash-b'), 1);
  assert.equal(resolveFullViewIndex(images, 'logo.svg'), 1);
  assert.equal(resolveFullViewIndex(images, '2'), 1);
  assert.equal(resolveFullViewIndex(images, 'missing'), 0);
});
