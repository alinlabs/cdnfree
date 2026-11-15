import type { ResourceRecord } from '../types/inspection';
import { buildProxyAssetUrl, encodeProxyUrlClient } from '../utils/proxy-url';
import { getAssetDownloadEligibility } from '../utils/safe-external-url';

export interface AssetDownloadOutcome {
  ok: true;
  filename: string;
  bytes: number;
}

export interface AssetDownloadError {
  ok: false;
  status?: number;
  message: string;
}

const DANGEROUS_DOWNLOAD_MIME_SUBSTRINGS = [
  'text/html',
  'application/xhtml+xml',
  'javascript',
  'ecmascript',
  'x-msdownload',
  'x-msdos-program',
  'x-executable',
  'x-dosexec',
  'x-sh',
  'x-bat',
  'x-csh',
  'portable-executable',
  'java-archive',
  'application/hta',
  'text/vbscript',
];

function isBlockedDownloadMime(contentType: string): boolean {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mime) return false;
  return DANGEROUS_DOWNLOAD_MIME_SUBSTRINGS.some((token) => mime.includes(token));
}

function parseFilenameFromContentDisposition(headerValue: string | null): string | null {
  if (!headerValue) return null;

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // Fall through to plain filename match
    }
  }

  const plainMatch = /filename="([^"]+)"/i.exec(headerValue);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return null;
}

async function consumeDownloadResponse(
  response: Response,
  fallbackName: string,
): Promise<AssetDownloadOutcome | AssetDownloadError> {
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    if (contentType.includes('application/json')) {
      try {
        const payload = (await response.json()) as { message?: unknown; error?: unknown };
        const msg =
          typeof payload.message === 'string'
            ? payload.message
            : typeof payload.error === 'string'
              ? payload.error
              : 'Aset tidak dapat diunduh.';
        return {
          ok: false,
          status: response.status,
          message: msg,
        };
      } catch {
        return {
          ok: false,
          status: response.status,
          message: 'Respons kesalahan server tidak dapat dibaca.',
        };
      }
    }

    if (response.status === 413) {
      return {
        ok: false,
        status: 413,
        message: 'Ukuran aset melebihi batas transfer maksimum server.',
      };
    }

    if (response.status === 504) {
      return {
        ok: false,
        status: 504,
        message: 'Waktu unduhan aset dari server tujuan habis.',
      };
    }

    return {
      ok: false,
      status: response.status,
      message: 'Aset tidak dapat diunduh karena server menolak permintaan ini.',
    };
  }

  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    return {
      ok: false,
      message: 'Aset tidak dapat diunduh karena respons server berupa halaman HTML.',
    };
  }

  if (isBlockedDownloadMime(contentType)) {
    return {
      ok: false,
      message:
        'Aset tidak dapat diunduh karena tipe file tidak didukung atau berpotensi dieksekusi.',
    };
  }

  const blob = await response.blob();
  const filename =
    parseFilenameFromContentDisposition(
      response.headers.get('content-disposition'),
    ) || fallbackName;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }

  return {
    ok: true,
    filename,
    bytes: blob.size,
  };
}

export interface DownloadFallbackMetadata {
  url: string;
  referer?: string;
  assetKind?: ResourceRecord['assetKind'];
  kind?: ResourceRecord['kind'];
  mimeType?: string;
}

export async function downloadInspectedAsset(
  inspectionId: string,
  resourceId: string,
  fallbackName = 'aset-cdnfree',
  fallbackMeta?: DownloadFallbackMetadata,
): Promise<AssetDownloadOutcome | AssetDownloadError> {
  try {
    const response = await fetch('/api/assets/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inspectionId,
        resourceId,
        ...(fallbackMeta
          ? {
              url: fallbackMeta.url,
              referer: fallbackMeta.referer,
              assetKind: fallbackMeta.assetKind,
              kind: fallbackMeta.kind,
              mimeType: fallbackMeta.mimeType,
            }
          : {}),
      }),
    });

    return await consumeDownloadResponse(response, fallbackName);
  } catch {
    return {
      ok: false,
      message: 'Aset tidak dapat diunduh karena terjadi gangguan jaringan.',
    };
  }
}

export async function downloadProxiedUrlAsset(
  resourceUrl: string,
  fallbackName = 'aset-cdnfree',
): Promise<AssetDownloadOutcome | AssetDownloadError> {
  try {
    const response = await fetch(buildProxyAssetUrl(resourceUrl), {
      method: 'GET',
    });
    return await consumeDownloadResponse(response, fallbackName);
  } catch {
    return {
      ok: false,
      message: 'Aset tidak dapat diunduh karena terjadi gangguan jaringan.',
    };
  }
}

const STREAM_DIRECT_THRESHOLD_BYTES = 25 * 1024 * 1024;

function triggerDirectStreamDownload(
  inspectionId: string,
  resource: ResourceRecord,
  filename: string,
): void {
  const params = new URLSearchParams();
  if (/^https?:\/\//i.test(resource.url)) {
    params.set('u', encodeProxyUrlClient(resource.url));
  }
  if (resource.referer && /^https?:\/\//i.test(resource.referer)) {
    params.set('ref', encodeProxyUrlClient(resource.referer));
  }
  if (resource.assetKind) {
    params.set('ak', resource.assetKind);
  }
  if (resource.mimeType) {
    params.set('ct', resource.mimeType);
  }
  const qs = params.toString();
  const url = `/api/assets/${encodeURIComponent(inspectionId)}/${encodeURIComponent(resource.id)}/download${qs ? `?${qs}` : ''}`;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export async function downloadResourceAsset(
  inspectionId: string,
  resource: ResourceRecord,
  fallbackName = 'aset-cdnfree',
): Promise<AssetDownloadOutcome | AssetDownloadError> {
  const eligibility = getAssetDownloadEligibility(resource);
  if (!eligibility.eligible) {
    return {
      ok: false,
      message: eligibility.reason ?? 'Aset ini tidak tersedia untuk diunduh.',
    };
  }

  const isLargeOrHls =
    resource.assetKind === 'hls' ||
    Boolean(resource.hlsUrl?.startsWith('/api/hls/')) ||
    (typeof resource.declaredBytes === 'number' &&
      resource.declaredBytes > STREAM_DIRECT_THRESHOLD_BYTES);

  if (inspectionId && isLargeOrHls && typeof document !== 'undefined') {
    triggerDirectStreamDownload(inspectionId, resource, fallbackName);
    return {
      ok: true,
      filename: fallbackName,
      bytes: resource.declaredBytes ?? 0,
    };
  }

  if (inspectionId) {
    const boundOutcome = await downloadInspectedAsset(
      inspectionId,
      resource.id,
      fallbackName,
      {
        url: resource.url,
        referer: resource.referer,
        assetKind: resource.assetKind,
        kind: resource.kind,
        mimeType: resource.mimeType,
      },
    );
    if (boundOutcome.ok || boundOutcome.status !== 404) {
      return boundOutcome;
    }
  }

  return downloadProxiedUrlAsset(resource.url, fallbackName);
}
