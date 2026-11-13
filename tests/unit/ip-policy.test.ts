import test from 'node:test';
import assert from 'node:assert/strict';
import { isProhibitedIp } from '../../server/security/ip-policy.ts';
import { resolveAndValidateUrl } from '../../server/services/url-policy.ts';
import { InspectionPolicyError } from '../../server/types/server.ts';

test('isProhibitedIp blocks private, loopback, link-local, metadata, and reserved IPv4/IPv6', () => {
  const prohibited = [
    '0.0.0.0',
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:10.0.0.5',
    'fe80::1',
    'fe80::1%eth0',
    'fc00::1',
    'fd12:3456:789a::1',
    'ff02::1',
    '2001:db8::1',
    'not-an-ip',
  ];

  for (const ip of prohibited) {
    assert.equal(isProhibitedIp(ip), true, `Expected ${ip} to be prohibited`);
  }
});

test('isProhibitedIp allows genuinely public IPv4 and IPv6 addresses', () => {
  const allowed = [
    '93.184.216.34',
    '1.1.1.1',
    '8.8.8.8',
    '104.20.23.154',
    '2606:4700:10::6814:179a',
    '2001:4860:4860::8888',
  ];

  for (const ip of allowed) {
    assert.equal(isProhibitedIp(ip), false, `Expected ${ip} to be allowed`);
  }
});

test('resolveAndValidateUrl rejects unsupported schemes, credentials, localhost, and prohibited DNS records', async () => {
  await assert.rejects(
    () => resolveAndValidateUrl('ftp://example.com/file'),
    (err: unknown) =>
      err instanceof InspectionPolicyError && err.code === 'INVALID_URL',
  );

  await assert.rejects(
    () => resolveAndValidateUrl('https://user:pass@example.com/'),
    (err: unknown) =>
      err instanceof InspectionPolicyError && err.code === 'INVALID_URL',
  );

  await assert.rejects(
    () => resolveAndValidateUrl('http://localhost:3000/'),
    (err: unknown) =>
      err instanceof InspectionPolicyError &&
      err.code === 'PROHIBITED_DESTINATION',
  );

  // DNS returning a mix of public and private IPv4 must be rejected
  await assert.rejects(
    () =>
      resolveAndValidateUrl('https://rebind.example.com/', async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    (err: unknown) =>
      err instanceof InspectionPolicyError &&
      err.code === 'PROHIBITED_DESTINATION',
  );

  // DNS returning metadata IPv6-mapped address must be rejected
  await assert.rejects(
    () =>
      resolveAndValidateUrl('https://meta.example.com/', async () => [
        { address: '::ffff:169.254.169.254', family: 6 },
      ]),
    (err: unknown) =>
      err instanceof InspectionPolicyError &&
      err.code === 'PROHIBITED_DESTINATION',
  );
});
