import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../../src/utils/format-bytes.ts';
import {
  getAssetDownloadEligibility,
  validateExternalNavigationUrl,
} from '../../src/utils/safe-external-url.ts';
import type { ResourceRecord } from '../../src/types/inspection.ts';

test('formatBytes formats bytes, KB, MB cleanly and falls back when unknown', () => {
  assert.equal(formatBytes(undefined), 'Ukuran tidak diketahui');
  assert.equal(formatBytes(null), 'Ukuran tidak diketahui');
  assert.equal(formatBytes(-1), 'Ukuran tidak diketahui');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1,5 KB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2,0 MB');
});

test('validateExternalNavigationUrl allows http/https and blocks unsafe schemes or credentials', () => {
  const ok = validateExternalNavigationUrl('https://example.com/path?a=1');
  assert.equal(ok.safe, true);
  assert.equal(ok.host, 'example.com');

  assert.equal(validateExternalNavigationUrl('javascript:alert(1)').safe, false);
  assert.equal(validateExternalNavigationUrl('data:text/html,hello').safe, false);
  assert.equal(validateExternalNavigationUrl('file:///etc/passwd').safe, false);
  assert.equal(validateExternalNavigationUrl('https://user:pass@example.com').safe, false);
});

test('getAssetDownloadEligibility permits public media and blocks scripts, trackers, or unsafe schemes', () => {
  const baseResource: ResourceRecord = {
    id: 'res-1',
    url: 'https://cdn.example.com/photo.jpg',
    host: 'cdn.example.com',
    kind: 'image',
    source: 'html-img',
    observation: 'discovered',
    classification: 'allowed',
  };

  assert.equal(getAssetDownloadEligibility(baseResource).eligible, true);
  assert.equal(
    getAssetDownloadEligibility({ ...baseResource, kind: 'script' }).eligible,
    false,
  );
  assert.equal(
    getAssetDownloadEligibility({
      ...baseResource,
      classification: 'ad-or-tracker',
    }).eligible,
    false,
  );
  assert.equal(
    getAssetDownloadEligibility({
      ...baseResource,
      observation: 'blocked',
    }).eligible,
    false,
  );
  assert.equal(
    getAssetDownloadEligibility({
      ...baseResource,
      url: 'javascript:void(0)',
    }).eligible,
    false,
  );
});

test('resolveWebViewState distinguishes embeddable, denied, unsupported, mixed-content, and invalid URLs honestly', async () => {
  const { resolveWebViewState } = await import(
    '../../src/utils/web-view-policy.ts'
  );

  assert.equal(
    resolveWebViewState(
      'https://example.com/',
      { mode: 'embeddable' },
      'text/html; charset=utf-8',
      'https:',
    ).status,
    'embeddable-sandbox',
  );

  assert.equal(
    resolveWebViewState(
      'https://github.com/',
      {
        mode: 'external-only',
        reason: 'Situs tujuan menetapkan header X-Frame-Options yang melarang penyematan lintas-asal.',
      },
      'text/html',
      'https:',
    ).status,
    'denied-by-policy',
  );

  assert.equal(
    resolveWebViewState(
      'http://plain.example/',
      { mode: 'embeddable' },
      'text/html',
      'https:',
    ).status,
    'mixed-content-blocked',
  );

  assert.equal(
    resolveWebViewState(
      'https://cdn.example/data.json',
      { mode: 'embeddable' },
      'application/json',
      'https:',
    ).status,
    'unsupported-content',
  );

  assert.equal(
    resolveWebViewState(
      'javascript:alert(1)',
      { mode: 'embeddable' },
      'text/html',
      'https:',
    ).status,
    'invalid-url',
  );
});

