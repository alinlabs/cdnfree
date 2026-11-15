import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXOembedUrl,
  isXTwitterUrl,
  resolveProxyWebViewState,
} from '../../src/utils/web-view-policy.ts';

test('resolveProxyWebViewState always defaults HTML sites to Mode Ringan without Mode Engine', () => {
  const state = resolveProxyWebViewState(
    'https://alvareza.my.id/beranda',
    { mode: 'embeddable', reason: 'ok' },
    'text/html; charset=utf-8',
    'sess-abc',
  );

  assert.equal(state.status, 'embeddable-proxy');
  assert.equal(state.defaultRenderMode, 'light');
  assert.ok(state.proxyUrl?.startsWith('/api/proxy?u='));
  assert.equal('engineUrl' in state, false);
  assert.equal(state.isXDomain, false);
});

test('resolveProxyWebViewState honors bypassExternalLinks toggle in proxyUrl query', () => {
  const enabledState = resolveProxyWebViewState(
    'https://example.com/page',
    { mode: 'embeddable', reason: 'ok' },
    'text/html',
    'sess-1',
    { bypassExternalLinks: true },
  );
  assert.ok(enabledState.proxyUrl?.includes('&extbypass=1'));

  const disabledState = resolveProxyWebViewState(
    'https://example.com/page',
    { mode: 'embeddable', reason: 'ok' },
    'text/html',
    'sess-1',
    { bypassExternalLinks: false },
  );
  assert.ok(disabledState.proxyUrl?.includes('&extbypass=0'));
});

test('non-HTML responses keep direct asset preview mode and X.com helpers identify official oEmbed target', () => {
  const imgState = resolveProxyWebViewState(
    'https://cdn.example.com/hero.webp',
    { mode: 'unsupported', reason: 'binary' },
    'image/webp',
    'sess-img',
  );
  assert.equal(imgState.directAssetKind, 'image');
  assert.equal(imgState.defaultRenderMode, 'light');

  assert.equal(isXTwitterUrl('https://x.com/user/status/123'), true);
  assert.equal(isXTwitterUrl('https://twitter.com/user'), true);
  assert.equal(isXTwitterUrl('https://example.com/x.com'), false);
  assert.equal(
    buildXOembedUrl('https://x.com/user/status/123'),
    'https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fstatus%2F123',
  );
});
