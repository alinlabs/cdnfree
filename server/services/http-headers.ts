import { CHROME_UA, type HeaderMode } from '../config/limits.ts';

export function buildHeaders(
  targetUrl: string,
  pageUrl: string | null,
  mode: HeaderMode,
): Record<string, string> {
  const parsedTarget = new URL(targetUrl);
  const headers: Record<string, string> = {
    'User-Agent': CHROME_UA,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
    // WAJIB identity agar deteksi magic byte pada 2048 byte pertama tidak rusak oleh gzip
    'Accept-Encoding': 'identity',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };

  if (mode === 'page-origin' && pageUrl) {
    try {
      const origin = new URL(pageUrl).origin;
      headers.Referer = pageUrl;
      headers.Origin = origin;
    } catch {
      // Abaikan referer tidak valid
    }
  } else if (mode === 'host-root') {
    headers.Referer = `${parsedTarget.protocol}//${parsedTarget.host}/`;
  }

  return headers;
}
