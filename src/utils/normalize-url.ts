export type NormalizeUrlResult =
  | {
      ok: true;
      normalizedUrl: string;
      host: string;
      protocol: 'http:' | 'https:';
      assumedHttps: boolean;
    }
  | {
      ok: false;
      reason:
        | 'EMPTY'
        | 'INVALID_FORMAT'
        | 'UNSUPPORTED_SCHEME'
        | 'CREDENTIALS_NOT_ALLOWED'
        | 'INVALID_PORT'
        | 'PROHIBITED_HOST';
      message: string;
    };

const EXPLICIT_SCHEME_REGEX = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?![0-9]+(?:[/?#]|$))/;
const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateOrReservedIpv4(ip: string): boolean {
  const match = IPV4_REGEX.exec(ip);
  if (!match) return false;

  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return true;
  }

  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 ("this" network)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && octets[2] === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast & reserved (224.0.0.0/4, 240.0.0.0/4)

  return false;
}

function normalizeIpv6Literal(host: string): string | null {
  if (!host.startsWith('[') || !host.endsWith(']')) return null;
  return host.slice(1, -1).toLowerCase();
}

function isProhibitedIpv6(rawIpv6: string): boolean {
  const ip = rawIpv6.split('%')[0];
  if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // IPv4-mapped IPv6 in dotted (::ffff:127.0.0.1) or hex (::ffff:7f00:1) form
  const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (mappedDotted && isPrivateOrReservedIpv4(mappedDotted[1])) {
    return true;
  }

  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (isPrivateOrReservedIpv4(ipv4)) {
      return true;
    }
  }

  // IPv4-compatible deprecated IPv6 (::127.0.0.1 -> canonical ::7f00:1) or ::/96
  if (/^::([0-9a-f]{1,4}:)?[0-9a-f]{1,4}$/i.test(ip)) {
    return true;
  }

  // NAT64 well-known (64:ff9b::/96) & 6to4 (2002::/16) & Teredo/Doc (2001::)
  if (
    ip.startsWith('64:ff9b:') ||
    ip.startsWith('2002:') ||
    ip.startsWith('2001:db8:') ||
    ip === '100::' ||
    ip.startsWith('100::')
  ) {
    return true;
  }

  const firstSegment = ip.split(':')[0];
  if (firstSegment) {
    const firstWord = parseInt(firstSegment, 16);
    if (!Number.isNaN(firstWord)) {
      if ((firstWord & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
      if ((firstWord & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
      if ((firstWord & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    }
  }

  return false;
}

export function isProhibitedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, '');
  if (!lower) return true;

  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  const ipv6 = normalizeIpv6Literal(lower);
  if (ipv6 !== null) {
    return isProhibitedIpv6(ipv6);
  }

  if (IPV4_REGEX.test(lower)) {
    return isPrivateOrReservedIpv4(lower);
  }

  return false;
}

function hasValidDomainShape(hostname: string): boolean {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.length > 2;
  }

  if (IPV4_REGEX.test(hostname)) {
    return true;
  }

  // Require at least one dot for domain names and valid label characters
  const cleaned = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (!cleaned.includes('.') || cleaned.length > 253) {
    return false;
  }

  const labels = cleaned.split('.');
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-zA-Z0-9-]+$/.test(label) &&
      !label.startsWith('-') &&
      !label.endsWith('-'),
  );
}

export function normalizeUrlInput(rawInput: string): NormalizeUrlResult {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return {
      ok: false,
      reason: 'EMPTY',
      message: 'Masukkan URL situs yang ingin diperiksa.',
    };
  }

  if (/\s/.test(trimmed)) {
    return {
      ok: false,
      reason: 'INVALID_FORMAT',
      message: 'URL tidak boleh mengandung spasi.',
    };
  }

  if (trimmed.startsWith('//')) {
    return {
      ok: false,
      reason: 'INVALID_FORMAT',
      message: 'Gunakan alamat lengkap dengan awalan http:// atau https://.',
    };
  }

  const schemeMatch = EXPLICIT_SCHEME_REGEX.exec(trimmed);
  let candidate = trimmed;
  let assumedHttps = false;

  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return {
        ok: false,
        reason: 'UNSUPPORTED_SCHEME',
        message: 'Hanya protokol http:// dan https:// yang didukung.',
      };
    }

    // Require "//" after http: or https:
    if (!/^https?:\/\//i.test(trimmed)) {
      return {
        ok: false,
        reason: 'INVALID_FORMAT',
        message: 'Format URL tidak valid. Gunakan format https://contoh.com.',
      };
    }
  } else {
    // Reject obvious host:port without scheme if it looks ambiguous like "localhost:3000"
    // or prepend https:// only when input begins with an unambiguous hostname/IPv4/IPv6
    candidate = `https://${trimmed}`;
    assumedHttps = true;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      reason: 'INVALID_FORMAT',
      message: 'Format URL tidak valid. Periksa kembali alamat situs.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'UNSUPPORTED_SCHEME',
      message: 'Hanya protokol http:// dan https:// yang didukung.',
    };
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return {
      ok: false,
      reason: 'CREDENTIALS_NOT_ALLOWED',
      message: 'URL yang mengandung nama pengguna atau kata sandi tidak diizinkan.',
    };
  }

  if (parsed.port !== '') {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return {
        ok: false,
        reason: 'INVALID_PORT',
        message: 'Nomor port pada URL tidak valid.',
      };
    }
  }

  if (isProhibitedHostname(parsed.hostname)) {
    return {
      ok: false,
      reason: 'PROHIBITED_HOST',
      message: 'Alamat lokal, privat, atau jaringan internal tidak dapat diperiksa.',
    };
  }

  if (!hasValidDomainShape(parsed.hostname)) {
    return {
      ok: false,
      reason: 'INVALID_FORMAT',
      message: 'Nama host tidak valid. Masukkan domain lengkap seperti contoh.com.',
    };
  }

  return {
    ok: true,
    normalizedUrl: parsed.toString(),
    host: parsed.hostname,
    protocol: parsed.protocol,
    assumedHttps,
  };
}
