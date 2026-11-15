import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXOembedUrl,
  clearEngineHostFailures,
  ENGINE_FALLBACK_STORAGE_KEY,
  ENGINE_FAILURE_THRESHOLD,
  getEngineHostFailures,
  isXTwitterUrl,
  recordEngineHostFailure,
  resolveProxyWebViewState,
  shouldAutoFallbackToLight,
} from '../../src/utils/web-view-policy.ts';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

test('resolveProxyWebViewState defaults HTML sites to Mode Engine and exposes /p/# engineUrl', () => {
  const storage = createMemoryStorage();
  const state = resolveProxyWebViewState(
    'https://alvareza.my.id/beranda',
    { mode: 'embeddable', reason: 'ok' },
    'text/html; charset=utf-8',
    'sess-abc',
    { storage },
  );

  assert.equal(state.status, 'embeddable-proxy');
  assert.equal(state.defaultRenderMode, 'engine');
  assert.equal(
    state.engineUrl,
    `/p/#${encodeURIComponent('https://alvareza.my.id/beranda')}`,
  );
  assert.ok(state.proxyUrl?.startsWith('/api/proxy?u='));
  assert.equal(state.isXDomain, false);
});

test('cdnfree:engine-fallback:v1 auto-switches to Mode Ringan after 2 Engine failures per host', () => {
  const storage = createMemoryStorage();
  const host = 'flaky.example.com';

  assert.equal(getEngineHostFailures(host, storage), 0);
  assert.equal(shouldAutoFallbackToLight(host, storage), false);

  assert.equal(recordEngineHostFailure(host, storage), 1);
  assert.equal(shouldAutoFallbackToLight(host, storage), false);

  assert.equal(recordEngineHostFailure(host, storage), ENGINE_FAILURE_THRESHOLD);
  assert.equal(shouldAutoFallbackToLight(host, storage), true);

  const rawStored = storage.getItem(ENGINE_FALLBACK_STORAGE_KEY);
  assert.ok(rawStored?.includes('"flaky.example.com":2'));

  const resolvedAfter2Failures = resolveProxyWebViewState(
    'https://flaky.example.com/page',
    { mode: 'embeddable', reason: 'ok' },
    'text/html',
    'sess-xyz',
    { storage },
  );
  assert.equal(resolvedAfter2Failures.defaultRenderMode, 'light');

  clearEngineHostFailures(host, storage);
  assert.equal(getEngineHostFailures(host, storage), 0);
  assert.equal(shouldAutoFallbackToLight(host, storage), false);
});

test('non-HTML responses keep direct asset preview mode and X.com helpers identify official oEmbed target', () => {
  const storage = createMemoryStorage();
  const imgState = resolveProxyWebViewState(
    'https://cdn.example.com/hero.webp',
    { mode: 'unsupported', reason: 'binary' },
    'image/webp',
    'sess-img',
    { storage },
  );
  assert.equal(imgState.directAssetKind, 'image');
  assert.equal(imgState.defaultRenderMode, 'light');
  assert.equal(imgState.engineUrl, null);

  assert.equal(isXTwitterUrl('https://x.com/user/status/123'), true);
  assert.equal(isXTwitterUrl('https://twitter.com/user'), true);
  assert.equal(isXTwitterUrl('https://example.com/x.com'), false);
  assert.equal(
    buildXOembedUrl('https://x.com/user/status/123'),
    'https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fstatus%2F123',
  );
});
