import dns from 'node:dns';
import net from 'node:net';
import { isProhibitedIp } from '../security/ip-policy.ts';
import {
  InspectionPolicyError,
  type DnsAddressRecord,
  type DnsLookupFn,
} from '../types/server.ts';

const PROHIBITED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.arpa',
];

export interface ValidatedTarget {
  url: URL;
  normalizedUrl: string;
  hostname: string;
  isIdn: boolean;
  pinnedAddress: DnsAddressRecord;
  resolvedAddresses: DnsAddressRecord[];
}

export async function defaultDnsLookup(hostname: string): Promise<DnsAddressRecord[]> {
  const results = await dns.promises.lookup(hostname, {
    all: true,
    verbatim: true,
  });

  return results
    .filter((entry) => entry.family === 4 || entry.family === 6)
    .map((entry) => ({
      address: entry.address,
      family: entry.family as 4 | 6,
    }));
}

export function validateUrlSyntax(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) {
    throw new InspectionPolicyError(
      'INVALID_URL',
      'Format URL tidak valid.',
      400,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InspectionPolicyError(
      'INVALID_URL',
      'URL tidak dapat diproses. Pastikan format diawali http:// atau https://.',
      400,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InspectionPolicyError(
      'INVALID_URL',
      'Hanya protokol http:// dan https:// yang diizinkan.',
      400,
    );
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new InspectionPolicyError(
      'INVALID_URL',
      'URL yang mengandung kredensial tidak diizinkan.',
      400,
    );
  }

  if (parsed.port !== '') {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new InspectionPolicyError(
        'INVALID_URL',
        'Nomor port pada URL tidak valid.',
        400,
      );
    }
  }

  const hostLower = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostLower) {
    throw new InspectionPolicyError(
      'INVALID_URL',
      'Nama host pada URL tidak valid.',
      400,
    );
  }

  if (
    hostLower === 'localhost' ||
    PROHIBITED_HOSTNAME_SUFFIXES.some((suffix) => hostLower.endsWith(suffix))
  ) {
    throw new InspectionPolicyError(
      'PROHIBITED_DESTINATION',
      'Alamat lokal atau jaringan internal tidak dapat diperiksa.',
      403,
    );
  }

  return parsed;
}

export async function resolveAndValidateUrl(
  rawUrl: string,
  dnsLookup: DnsLookupFn = defaultDnsLookup,
): Promise<ValidatedTarget> {
  const parsed = validateUrlSyntax(rawUrl);
  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '');
  const isIdn =
    rawHost.toLowerCase().startsWith('xn--') ||
    rawHost.toLowerCase().includes('.xn--');

  const ipFamily = net.isIP(rawHost);
  if (ipFamily === 4 || ipFamily === 6) {
    if (isProhibitedIp(rawHost)) {
      throw new InspectionPolicyError(
        'PROHIBITED_DESTINATION',
        'Alamat IP privat, loopback, atau terlarang tidak dapat diperiksa.',
        403,
      );
    }

    const pinned: DnsAddressRecord = {
      address: rawHost,
      family: ipFamily as 4 | 6,
    };

    return {
      url: parsed,
      normalizedUrl: parsed.toString(),
      hostname: rawHost,
      isIdn,
      pinnedAddress: pinned,
      resolvedAddresses: [pinned],
    };
  }

  let resolved: DnsAddressRecord[];
  try {
    resolved = await dnsLookup(rawHost);
  } catch {
    throw new InspectionPolicyError(
      'DNS_RESOLUTION_FAILED',
      'Nama domain tujuan tidak dapat ditemukan melalui DNS.',
      502,
    );
  }

  if (!resolved || resolved.length === 0) {
    throw new InspectionPolicyError(
      'DNS_RESOLUTION_FAILED',
      'Domain tujuan tidak mengembalikan alamat IP yang valid.',
      502,
    );
  }

  // Reject if ANY DNS A/AAAA record points to a prohibited range
  for (const record of resolved) {
    if (isProhibitedIp(record.address)) {
      throw new InspectionPolicyError(
        'PROHIBITED_DESTINATION',
        'Domain tujuan mengarah ke alamat jaringan yang dibatasi oleh kebijakan keamanan.',
        403,
      );
    }
  }

  // Prefer IPv4 when available for widest public server compatibility, otherwise IPv6
  const preferred = resolved.find((r) => r.family === 4) ?? resolved[0];

  return {
    url: parsed,
    normalizedUrl: parsed.toString(),
    hostname: rawHost,
    isIdn,
    pinnedAddress: preferred,
    resolvedAddresses: resolved,
  };
}
