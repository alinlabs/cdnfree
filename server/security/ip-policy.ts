import net from 'node:net';

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value >>> 0;
}

function cidrMask32(prefixBits: number): number {
  if (prefixBits === 0) return 0;
  return (~((1 << (32 - prefixBits)) - 1)) >>> 0;
}

const PROHIBITED_IPV4_CIDRS: Array<[number, number]> = [
  ['0.0.0.0', 8],          // "This" network
  ['10.0.0.0', 8],         // Private RFC 1918
  ['100.64.0.0', 10],      // Shared Address Space / CGNAT RFC 6598
  ['127.0.0.0', 8],        // Loopback
  ['169.254.0.0', 16],     // Link-local & cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],      // Private RFC 1918
  ['192.0.0.0', 24],       // IETF protocol assignments
  ['192.0.2.0', 24],       // TEST-NET-1
  ['192.88.99.0', 24],     // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16],     // Private RFC 1918
  ['198.18.0.0', 15],      // Benchmarking
  ['198.51.100.0', 24],    // TEST-NET-2
  ['203.0.113.0', 24],     // TEST-NET-3
  ['224.0.0.0', 4],        // Multicast
  ['240.0.0.0', 4],        // Reserved / broadcast
].map(([base, bits]) => [ipv4ToUint32(base as string)!, cidrMask32(bits as number)]);

export function isProhibitedIpv4(ip: string): boolean {
  const num = ipv4ToUint32(ip);
  if (num === null) return true;
  return PROHIBITED_IPV4_CIDRS.some(
    ([base, mask]) => ((num & mask) >>> 0) === ((base & mask) >>> 0),
  );
}

function parseIpv6ToBigInt(rawIp: string): bigint | null {
  const ip = rawIp.split('%')[0].toLowerCase();
  if (!ip) return null;

  // Handle embedded IPv4 suffix (e.g. ::ffff:127.0.0.1)
  let working = ip;
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const ipv4Part = working.slice(lastColon + 1);
    const v4Num = ipv4ToUint32(ipv4Part);
    if (v4Num === null) return null;
    const hi = ((v4Num >>> 16) & 0xffff).toString(16);
    const lo = (v4Num & 0xffff).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const halves = working.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (segment: string): number[] | null => {
    if (!segment) return [];
    const parts = segment.split(':');
    const out: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  let groups: number[] = [];
  if (halves.length === 2) {
    const left = parseGroups(halves[0]);
    const right = parseGroups(halves[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    const full = parseGroups(working);
    if (!full || full.length !== 8) return null;
    groups = full;
  }

  let result = 0n;
  for (const g of groups) {
    result = (result << 16n) | BigInt(g);
  }
  return result;
}

function ipv6Range(baseHex: string, prefixBits: number): { base: bigint; mask: bigint } {
  const base = parseIpv6ToBigInt(baseHex)!;
  const hostBits = BigInt(128 - prefixBits);
  const allOnes = (1n << 128n) - 1n;
  const mask = hostBits === 128n ? 0n : (allOnes ^ ((1n << hostBits) - 1n));
  return { base: base & mask, mask };
}

const PROHIBITED_IPV6_RANGES = [
  ipv6Range('::', 128),          // Unspecified
  ipv6Range('::1', 128),         // Loopback
  ipv6Range('::', 96),           // IPv4-compatible (deprecated)
  ipv6Range('64:ff9b::', 96),    // NAT64 well-known prefix
  ipv6Range('64:ff9b:1::', 48),  // NAT64 local-use
  ipv6Range('100::', 64),        // Discard-Only
  ipv6Range('2001::', 32),       // Teredo
  ipv6Range('2001:2::', 48),     // Benchmarking
  ipv6Range('2001:db8::', 32),   // Documentation
  ipv6Range('2002::', 16),       // 6to4
  ipv6Range('fc00::', 7),        // Unique local address (ULA)
  ipv6Range('fe80::', 10),       // Link-local
  ipv6Range('ff00::', 8),        // Multicast
];

const V4_MAPPED_PREFIX = 0xffff00000000n;
const V4_MAPPED_MASK = 0xffffffffffffffffffffffff00000000n;

export function isProhibitedIpv6(ip: string): boolean {
  const value = parseIpv6ToBigInt(ip);
  if (value === null) return true;

  // Check IPv4-mapped IPv6 (::ffff:0:0/96) against full IPv4 policy
  if ((value & V4_MAPPED_MASK) === V4_MAPPED_PREFIX) {
    const v4 = Number(value & 0xffffffffn);
    const dotted = [
      (v4 >>> 24) & 0xff,
      (v4 >>> 16) & 0xff,
      (v4 >>> 8) & 0xff,
      v4 & 0xff,
    ].join('.');
    return isProhibitedIpv4(dotted);
  }

  return PROHIBITED_IPV6_RANGES.some(({ base, mask }) => (value & mask) === base);
}

export function isProhibitedIp(address: string): boolean {
  const stripped = address.replace(/^\[|\]$/g, '').split('%')[0];
  const version = net.isIP(stripped);
  if (version === 4) {
    return isProhibitedIpv4(stripped);
  }
  if (version === 6) {
    return isProhibitedIpv6(stripped);
  }
  return true;
}
