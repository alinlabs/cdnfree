import type { Response } from 'express';
import { InspectionPolicyError } from '../../types/server.ts';
import type { SafeProxyFetchResult } from './safe-proxy-fetch.ts';
import { readStreamWithLimit } from './stream-response.ts';

export function getHeaderSingle(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderFriendlyErrorHtml(title: string, message: string): string {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlText(title)}</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #ffffff; color: #242424; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; }
    .box { max-width: 480px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; background: #f9fafb; }
    h1 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
    p { margin: 0; font-size: 14px; line-height: 1.5; color: #525252; }
  </style>
</head>
<body>
  <div class="box" role="alert">
    <h1>${escapeHtmlText(title)}</h1>
    <p>${escapeHtmlText(message)}</p>
  </div>
</body>
</html>`;
}

export function mapProxyError(err: unknown): {
  httpStatus: number;
  code: string;
  message: string;
} {
  if (err instanceof InspectionPolicyError) {
    const codeMap: Record<string, string> = {
      PROHIBITED_DESTINATION: 'private_host',
      DNS_RESOLUTION_FAILED: 'dns_fail',
      INVALID_URL: 'bad_scheme',
      TIMEOUT: 'upstream_timeout',
    };
    return {
      httpStatus: err.httpStatus,
      code: codeMap[err.code] ?? err.code,
      message: err.message,
    };
  }
  return {
    httpStatus: 502,
    code: 'UPSTREAM_ERROR',
    message: 'Situs tujuan gagal dimuat melalui proxy.',
  };
}

export function isJavaScriptMime(mime: string, url: string): boolean {
  if (
    mime === 'application/javascript' ||
    mime === 'text/javascript' ||
    mime === 'application/x-javascript' ||
    mime === 'application/ecmascript' ||
    mime === 'text/ecmascript'
  ) {
    return true;
  }
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.js') || pathname.endsWith('.mjs');
  } catch {
    return false;
  }
}

export function isSvgAsset(mime: string, url: string): boolean {
  if (mime === 'image/svg+xml') return true;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (!pathname.endsWith('.svg')) return false;
    return (
      !mime ||
      mime === 'text/xml' ||
      mime === 'application/xml' ||
      mime === 'text/plain' ||
      mime === 'application/octet-stream'
    );
  } catch {
    return false;
  }
}

export function isPdfAsset(mime: string, url: string): boolean {
  if (mime === 'application/pdf') return true;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (!pathname.endsWith('.pdf')) return false;
    return !mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream';
  } catch {
    return false;
  }
}

export function isM3u8Asset(mime: string, url: string): boolean {
  if (
    mime === 'application/vnd.apple.mpegurl' ||
    mime === 'application/x-mpegurl'
  ) {
    return true;
  }
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return url.toLowerCase().includes('.m3u8');
  }
}

export async function resolveUpstreamBuffer(
  upstream: SafeProxyFetchResult,
  maxBytes: number,
): Promise<Buffer> {
  if (upstream.body) {
    if (upstream.body.length > maxBytes) {
      throw new InspectionPolicyError(
        'RESPONSE_TOO_LARGE',
        'Ukuran respons situs tujuan melebihi batas maksimum proxy.',
        413,
      );
    }
    return upstream.body;
  }
  if (!upstream.stream) {
    return Buffer.alloc(0);
  }
  const contentEncoding = getHeaderSingle(upstream.headers['content-encoding']);
  return readStreamWithLimit(upstream.stream, maxBytes, contentEncoding);
}

export function resolveTotalBytesFromHeaders(
  headers: SafeProxyFetchResult['headers'],
  fallbackBody?: Buffer,
): number | undefined {
  const contentRange = getHeaderSingle(headers['content-range']);
  if (contentRange) {
    const totalToken = contentRange.split('/')[1]?.trim();
    if (totalToken && /^\d+$/.test(totalToken)) {
      return Number(totalToken);
    }
  }
  const contentLength = getHeaderSingle(headers['content-length']);
  if (contentLength && /^\d+$/.test(contentLength.trim())) {
    return Number(contentLength.trim());
  }
  return fallbackBody?.length;
}

export function applyMediaPassThroughHeaders(
  res: Response,
  upstream: SafeProxyFetchResult,
  resolvedContentType: string,
): void {
  res.setHeader('Content-Type', resolvedContentType);
  res.setHeader(
    'Accept-Ranges',
    getHeaderSingle(upstream.headers['accept-ranges']) ?? 'bytes',
  );

  const len = getHeaderSingle(upstream.headers['content-length']);
  const cr = getHeaderSingle(upstream.headers['content-range']);
  if (len) res.setHeader('Content-Length', len);
  if (cr) res.setHeader('Content-Range', cr);

  const ce = getHeaderSingle(upstream.headers['content-encoding']);
  if (ce && ce.trim().toLowerCase() !== 'identity') {
    res.setHeader('Content-Encoding', ce);
  }
}
