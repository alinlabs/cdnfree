import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResourceRecord } from '../../src/types/inspection.ts';
import {
  applyAssetKindChange,
  applyLinkModeChange,
  applyTargetModeChange,
  buildSearchConfigSummary,
  DEFAULT_PERSISTED_SEARCH_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  hasCustomSearchConfig,
  loadSearchConfig,
  matchesAssetFormatFilter,
  parseAssetFormatFilters,
  parseBulkUrlsInput,
  resetSearchConfig,
  resolveAutoBulkForUrlInput,
  saveSearchConfig,
  SEARCH_CONFIG_STORAGE_KEY,
  serializeAssetFormatFilters,
  toggleAssetFormat,
  type SearchConfigStorageLike,
} from '../../src/utils/search-config.ts';

function makeResource(overrides: Partial<ResourceRecord>): ResourceRecord {
  return {
    id: 'res-1',
    url: 'https://cdn.example.com/asset.bin',
    host: 'cdn.example.com',
    kind: 'image',
    source: 'html-img',
    observation: 'discovered',
    classification: 'allowed',
    ...overrides,
  };
}

test('search config state locks targetMode to aset when bulk mode is active', () => {
  const bulk = applyLinkModeChange(DEFAULT_SEARCH_CONFIG, 'bulk');
  assert.equal(bulk.linkMode, 'bulk');
  assert.equal(bulk.targetMode, 'aset');
  assert.equal(hasCustomSearchConfig(bulk), true);

  // Attempting to switch away from aset while in bulk mode keeps aset locked
  const attemptedWeb = applyTargetModeChange(bulk, 'web');
  assert.equal(attemptedWeb.targetMode, 'aset');
  const attemptedDetail = applyTargetModeChange(bulk, 'detail');
  assert.equal(attemptedDetail.targetMode, 'aset');

  // Switching back to single allows targetMode changes again
  const backToSingle = applyLinkModeChange(bulk, 'single');
  assert.equal(backToSingle.linkMode, 'single');
  const switchedDetail = applyTargetModeChange(backToSingle, 'detail');
  assert.equal(switchedDetail.targetMode, 'detail');
});

test('asset kind and format format filters stay consistent on toggles', () => {
  const withVideoKind = applyAssetKindChange(DEFAULT_SEARCH_CONFIG, 'video');
  const withMp4 = toggleAssetFormat(withVideoKind, 'mp4');
  assert.equal(withMp4.assetKind, 'video');
  assert.deepEqual(withMp4.assetFormats, ['mp4']);

  // Selecting an image format while video kind is active resets assetKind to 'all'
  const withCrossFormat = toggleAssetFormat(withMp4, 'png');
  assert.equal(withCrossFormat.assetKind, 'all');
  assert.deepEqual(withCrossFormat.assetFormats, ['mp4', 'png']);

  // Narrowing kind to image drops incompatible 'mp4' format automatically
  const narrowedToImage = applyAssetKindChange(withCrossFormat, 'image');
  assert.equal(narrowedToImage.assetKind, 'image');
  assert.deepEqual(narrowedToImage.assetFormats, ['png']);

  assert.match(buildSearchConfigSummary({ ...narrowedToImage, targetMode: 'aset' }), /PNG/);
});

test('parseAssetFormatFilters, serializeAssetFormatFilters, and matchesAssetFormatFilter match URLs and MIME types', () => {
  assert.deepEqual(parseAssetFormatFilters('jpg,invalid,png,JPG'), ['jpg', 'png']);
  assert.equal(serializeAssetFormatFilters(['svg', 'webp', 'svg']), 'svg,webp');

  const jpgByExt = makeResource({ url: 'https://img.example.com/photo.jpeg?w=800' });
  const svgByMime = makeResource({
    url: 'https://img.example.com/icon-endpoint',
    mimeType: 'image/svg+xml; charset=utf-8',
  });
  const mp4ByQuery = makeResource({
    kind: 'video',
    url: 'https://cdn.example.com/stream?format=mp4&quality=hd',
  });
  const cssFile = makeResource({
    kind: 'stylesheet',
    url: 'https://cdn.example.com/app.css',
    mimeType: 'text/css',
  });

  assert.equal(matchesAssetFormatFilter(jpgByExt, ['jpg']), true);
  assert.equal(matchesAssetFormatFilter(jpgByExt, ['png']), false);
  assert.equal(matchesAssetFormatFilter(svgByMime, ['svg']), true);
  assert.equal(matchesAssetFormatFilter(mp4ByQuery, ['mp4']), true);
  assert.equal(matchesAssetFormatFilter(cssFile, ['css', 'js']), true);
  assert.equal(matchesAssetFormatFilter(cssFile, ['pdf']), false);
});

test('parseBulkUrlsInput parses glued/spaced/multiline URLs, ignores noise words, deduplicates, and caps count', () => {
  const parsed = parseBulkUrlsInput(
    'example.com\nhttps://example.com/, kata acak tidak dianggap link, https://alvareza.com/video .mp4 dd\nhttps://iana.org/help/example-domainshttps://alvareza.com/video.mp5\nhttp://[bad',
  );
  assert.deepEqual(parsed.validUrls, [
    'https://example.com/',
    'https://alvareza.com/video.mp4',
    'https://iana.org/help/example-domains',
    'https://alvareza.com/video.mp5',
  ]);
  assert.equal(parsed.invalidEntries.length, 1);
  assert.equal(parsed.invalidEntries[0].raw, 'http://[bad');
  assert.equal(parsed.truncatedCount, 0);

  const many = parseBulkUrlsInput(
    Array.from({ length: 8 }, (_, idx) => `https://site${idx}.example.com`).join('\n'),
    5,
  );
  assert.equal(many.validUrls.length, 5);
  assert.equal(many.truncatedCount, 3);
});

test('resolveAutoBulkForUrlInput switches to bulk on 2+ URLs, reverts on <=1 URL, and respects manual overrides', () => {
  // Single URL stays single
  const singleRes = resolveAutoBulkForUrlInput({
    rawUrlInput: 'https://example.com',
    currentConfig: { ...DEFAULT_SEARCH_CONFIG, targetMode: 'detail' },
    origin: 'default',
    savedSingleTargetMode: 'web',
    suppressAutoBulk: false,
  });
  assert.equal(singleRes.config.linkMode, 'single');
  assert.equal(singleRes.config.targetMode, 'detail');
  assert.equal(singleRes.detectedUrlCount, 1);

  // Entering 2+ URLs automatically switches to bulk (aset) and remembers previous single targetMode
  const autoBulkRes = resolveAutoBulkForUrlInput({
    rawUrlInput: 'https://example.com\nhttps://iana.org',
    currentConfig: singleRes.config,
    origin: singleRes.origin,
    savedSingleTargetMode: singleRes.savedSingleTargetMode,
    suppressAutoBulk: singleRes.suppressAutoBulk,
  });
  assert.equal(autoBulkRes.config.linkMode, 'bulk');
  assert.equal(autoBulkRes.config.targetMode, 'aset');
  assert.equal(autoBulkRes.origin, 'auto');
  assert.equal(autoBulkRes.savedSingleTargetMode, 'detail');
  assert.equal(autoBulkRes.detectedUrlCount, 2);

  // Reducing back to 1 URL reverts auto-bulk back to single and restores 'detail'
  const revertedRes = resolveAutoBulkForUrlInput({
    rawUrlInput: 'https://example.com',
    currentConfig: autoBulkRes.config,
    origin: autoBulkRes.origin,
    savedSingleTargetMode: autoBulkRes.savedSingleTargetMode,
    suppressAutoBulk: autoBulkRes.suppressAutoBulk,
  });
  assert.equal(revertedRes.config.linkMode, 'single');
  assert.equal(revertedRes.config.targetMode, 'detail');
  assert.equal(revertedRes.origin, 'default');

  // Manual bulk stays bulk even when input is empty
  const manualBulkRes = resolveAutoBulkForUrlInput({
    rawUrlInput: '',
    currentConfig: applyLinkModeChange(DEFAULT_SEARCH_CONFIG, 'bulk'),
    origin: 'manual',
    savedSingleTargetMode: 'web',
    suppressAutoBulk: false,
  });
  assert.equal(manualBulkRes.config.linkMode, 'bulk');
  assert.equal(manualBulkRes.origin, 'manual');

  // Suppressed auto-bulk respects manual single choice until URL count drops below 2
  const suppressedRes = resolveAutoBulkForUrlInput({
    rawUrlInput: 'https://example.com https://iana.org https://mozilla.org',
    currentConfig: DEFAULT_SEARCH_CONFIG,
    origin: 'manual',
    savedSingleTargetMode: 'web',
    suppressAutoBulk: true,
  });
  assert.equal(suppressedRes.config.linkMode, 'single');
  assert.equal(suppressedRes.suppressAutoBulk, true);

  const clearedSuppressionRes = resolveAutoBulkForUrlInput({
    rawUrlInput: 'https://example.com',
    currentConfig: suppressedRes.config,
    origin: suppressedRes.origin,
    savedSingleTargetMode: suppressedRes.savedSingleTargetMode,
    suppressAutoBulk: suppressedRes.suppressAutoBulk,
  });
  assert.equal(clearedSuppressionRes.suppressAutoBulk, false);
});

function createMemoryStorage(): SearchConfigStorageLike {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

test('search config persists across loads until explicitly reset and handles corrupt values safely', () => {
  const storage = createMemoryStorage();

  // Empty storage yields defaults
  assert.deepEqual(loadSearchConfig(storage), DEFAULT_PERSISTED_SEARCH_CONFIG);

  // Saving custom single-aset-video configuration persists across reloads
  saveSearchConfig(
    {
      config: {
        linkMode: 'single',
        targetMode: 'aset',
        assetKind: 'video',
        assetFormats: ['mp4'],
        assetKeyword: 'trailer',
      },
      linkModeOrigin: 'default',
      savedSingleTargetMode: 'aset',
    },
    storage,
  );
  const reloadedSingle = loadSearchConfig(storage);
  assert.equal(reloadedSingle.config.linkMode, 'single');
  assert.equal(reloadedSingle.config.targetMode, 'aset');
  assert.equal(reloadedSingle.config.assetKind, 'video');
  assert.deepEqual(reloadedSingle.config.assetFormats, ['mp4']);
  assert.equal(reloadedSingle.config.assetKeyword, 'trailer');

  // Saving bulk configuration forces targetMode to aset and persists manual origin
  saveSearchConfig(
    {
      config: {
        linkMode: 'bulk',
        targetMode: 'web',
        assetKind: 'image',
        assetFormats: ['png', 'invalid' as never],
        assetKeyword: '',
      },
      linkModeOrigin: 'manual',
      savedSingleTargetMode: 'detail',
    },
    storage,
  );
  const reloadedBulk = loadSearchConfig(storage);
  assert.equal(reloadedBulk.config.linkMode, 'bulk');
  assert.equal(reloadedBulk.config.targetMode, 'aset');
  assert.equal(reloadedBulk.config.assetKind, 'image');
  assert.deepEqual(reloadedBulk.config.assetFormats, ['png']);
  assert.equal(reloadedBulk.linkModeOrigin, 'manual');
  assert.equal(reloadedBulk.savedSingleTargetMode, 'detail');

  // Explicit reset restores defaults and removes persisted key
  const resetResult = resetSearchConfig(storage);
  assert.deepEqual(resetResult, DEFAULT_PERSISTED_SEARCH_CONFIG);
  assert.equal(storage.getItem(SEARCH_CONFIG_STORAGE_KEY), null);
  assert.deepEqual(loadSearchConfig(storage), DEFAULT_PERSISTED_SEARCH_CONFIG);

  // Corrupt JSON safely falls back to defaults
  storage.setItem(SEARCH_CONFIG_STORAGE_KEY, '{not-valid-json');
  assert.deepEqual(loadSearchConfig(storage), DEFAULT_PERSISTED_SEARCH_CONFIG);
});

