import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrlInput } from '../../src/utils/normalize-url';

test('normalizeUrlInput trims and prepends https:// when unambiguous', () => {
  const res = normalizeUrlInput('  example.com/path?q=1  ');
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.normalizedUrl, 'https://example.com/path?q=1');
    assert.equal(res.host, 'example.com');
    assert.equal(res.protocol, 'https:');
    assert.equal(res.assumedHttps, true);
  }
});

test('normalizeUrlInput preserves explicit http/https and host:port', () => {
  const httpRes = normalizeUrlInput('http://cdn.example.org/assets/app.js');
  assert.equal(httpRes.ok, true);
  if (httpRes.ok) {
    assert.equal(httpRes.protocol, 'http:');
    assert.equal(httpRes.assumedHttps, false);
  }

  const portRes = normalizeUrlInput('example.com:8443/v1');
  assert.equal(portRes.ok, true);
  if (portRes.ok) {
    assert.equal(portRes.normalizedUrl, 'https://example.com:8443/v1');
  }
});

test('normalizeUrlInput rejects empty, spaces, and unsupported schemes', () => {
  assert.equal(normalizeUrlInput('   ').ok, false);
  assert.equal(normalizeUrlInput('https://example.com/a b').ok, false);
  assert.equal(normalizeUrlInput('//example.com').ok, false);

  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://files.example.com',
    'http:example.com',
  ]) {
    const res = normalizeUrlInput(bad);
    assert.equal(res.ok, false, `Expected ${bad} to be rejected`);
  }
});

test('normalizeUrlInput rejects embedded credentials and malformed hostnames', () => {
  for (const bad of [
    'https://user:pass@example.com',
    'https://example.com@evil.com',
    'user@example.com',
    'singletoken',
    '-invalid.example.com',
    'invalid-.example.com',
    'bad..example.com',
    'https://example.com:99999',
  ]) {
    const res = normalizeUrlInput(bad);
    assert.equal(res.ok, false, `Expected ${bad} to be rejected`);
  }
});

test('normalizeUrlInput rejects localhost, private, loopback, metadata, and prohibited IPv6 literals', () => {
  for (const prohibited of [
    'localhost',
    'http://localhost:3000',
    'http://app.localhost',
    'http://printer.local',
    'http://service.internal',
    'http://127.0.0.1',
    'http://10.0.0.5',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0',
    'http://0x7f000001',
    'http://2130706433',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:7f00:1]',
    'http://[fe80::1]',
    'http://[fc00::1]',
  ]) {
    const res = normalizeUrlInput(prohibited);
    assert.equal(res.ok, false, `Expected ${prohibited} to be rejected`);
    if (!res.ok) {
      assert.equal(res.reason, 'PROHIBITED_HOST', `Wrong reason for ${prohibited}: ${res.reason}`);
    }
  }
});
