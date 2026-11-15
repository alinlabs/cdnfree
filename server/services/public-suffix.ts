import net from 'node:net';

/**
 * Curated subset of common multi-label public suffixes (adapted from Public Suffix List
 * conventions, MPL-2.0 — https://publicsuffix.org/). Used to avoid misclassifying two
 * unrelated sites sharing a second-level ccTLD/hosting suffix (e.g. a.co.uk vs b.co.uk)
 * as first-party.
 */
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  // United Kingdom
  'co.uk',
  'org.uk',
  'me.uk',
  'net.uk',
  'ac.uk',
  'gov.uk',
  'nhs.uk',
  'police.uk',
  // Indonesia
  'co.id',
  'or.id',
  'ac.id',
  'go.id',
  'web.id',
  'sch.id',
  'net.id',
  'my.id',
  'biz.id',
  // Australia & New Zealand
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'co.nz',
  'org.nz',
  'govt.nz',
  'ac.nz',
  // Japan, Korea, Taiwan, China, Singapore, Malaysia
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'ed.jp',
  'co.kr',
  'or.kr',
  'ne.kr',
  'com.tw',
  'org.tw',
  'net.tw',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'com.hk',
  'org.hk',
  'com.sg',
  'org.sg',
  'com.my',
  'org.my',
  'net.my',
  // Americas, Europe, Africa, Asia
  'com.br',
  'org.br',
  'net.br',
  'com.ar',
  'com.mx',
  'co.in',
  'net.in',
  'org.in',
  'ac.in',
  'co.za',
  'org.za',
  'com.tr',
  'co.il',
  'co.th',
  'com.vn',
  'com.ph',
  // Shared hosting / multi-tenant platform public suffixes
  'github.io',
  'gitlab.io',
  'pages.dev',
  'workers.dev',
  'netlify.app',
  'vercel.app',
  'cloudfront.net',
  'herokuapp.com',
  'appspot.com',
  'blogspot.com',
  'wordpress.com',
  's3.amazonaws.com',
]);

export function getRegistrableDomain(rawHostname: string): string {
  const host = rawHostname.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) return '';
  if (net.isIP(host) !== 0) {
    return host;
  }

  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('.');
  }

  // Check up to 3 trailing labels for known multi-part public suffixes
  const lastThree = parts.slice(-3).join('.');
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(lastThree)) {
    return parts.length >= 4 ? parts.slice(-4).join('.') : host;
  }

  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }

  return lastTwo;
}

export function isSameSiteHost(hostA: string, hostB: string): boolean {
  const cleanA = hostA.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  const cleanB = hostB.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;

  if (net.isIP(cleanA) !== 0 || net.isIP(cleanB) !== 0) {
    return cleanA === cleanB;
  }

  return getRegistrableDomain(cleanA) === getRegistrableDomain(cleanB);
}
