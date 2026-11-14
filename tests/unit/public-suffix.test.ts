import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRegistrableDomain,
  isSameSiteHost,
} from '../../server/services/public-suffix.ts';
import { isThirdPartyHost } from '../../server/services/filter-engine.ts';

test('getRegistrableDomain handles standard domains, multi-label public suffixes, and IP literals', () => {
  assert.equal(getRegistrableDomain('sub.example.com.'), 'example.com');
  assert.equal(getRegistrableDomain('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(getRegistrableDomain('cdn.kompas.co.id'), 'kompas.co.id');
  assert.equal(getRegistrableDomain('my-app.github.io'), 'my-app.github.io');
  assert.equal(getRegistrableDomain('bucket.s3.amazonaws.com'), 'bucket.s3.amazonaws.com');
  assert.equal(getRegistrableDomain('93.184.216.34'), '93.184.216.34');
});

test('isThirdPartyHost distinguishes independent sites under shared ccTLD suffixes and IP literals', () => {
  assert.equal(isSameSiteHost('static.example.co.uk', 'www.example.co.uk'), true);
  assert.equal(isThirdPartyHost('static.example.co.uk', 'www.example.co.uk'), false);

  assert.equal(isSameSiteHost('tracker.co.uk', 'news.co.uk'), false);
  assert.equal(isThirdPartyHost('tracker.co.uk', 'news.co.uk'), true);

  assert.equal(isThirdPartyHost('ads.evil.co.id', 'portal.co.id'), true);
  assert.equal(isThirdPartyHost('cdn.portal.co.id', 'www.portal.co.id'), false);

  assert.equal(isThirdPartyHost('5.6.3.4', '1.2.3.4'), true);
  assert.equal(isThirdPartyHost('1.2.3.4', '1.2.3.4'), false);
});
