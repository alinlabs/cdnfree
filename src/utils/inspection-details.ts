import type {
  InspectionResult,
  LinkRecord,
  ResourceRecord,
} from '../types/inspection';
import { redactUrlForDisplay } from './redact-url';

export interface DerivedInspectionDetails {
  originHost: string;
  finalHost: string;
  urlsDiffer: boolean;
  submittedDisplayUrl: string;
  finalDisplayUrl: string;
  canonicalDisplayUrl?: string;
  hasRedirects: boolean;
  reviewLinks: LinkRecord[];
  flaggedResources: ResourceRecord[];
  reviewTotalCount: number;
  limitations: string[];
}

const DEFAULT_STATIC_LIMITATION =
  'Analisis HTML statis tidak menjalankan JavaScript, sehingga aset yang baru dimuat setelah skrip berjalan tidak selalu terlihat.';

export function getHostnameSafe(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

export function getResourceKindLabelId(kind: ResourceRecord['kind']): string {
  switch (kind) {
    case 'image':
      return 'Gambar';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'script':
      return 'Skrip';
    case 'stylesheet':
      return 'Stylesheet';
    case 'font':
      return 'Font';
    case 'document':
      return 'Dokumen';
    default:
      return 'Lainnya';
  }
}

export function getReviewClassificationLabel(
  classification: LinkRecord['classification'] | ResourceRecord['classification'],
): string {
  switch (classification) {
    case 'known-malicious':
      return 'Terdaftar berisiko';
    case 'ad-or-tracker':
      return 'Cocok daftar filter';
    case 'suspicious':
      return 'Perlu ditinjau';
    case 'unknown':
      return 'Tidak diketahui';
    default:
      return 'Diizinkan';
  }
}

export function deriveInspectionDetails(
  result: InspectionResult,
): DerivedInspectionDetails {
  const originHost = getHostnameSafe(result.submittedUrl);
  const finalHost = getHostnameSafe(result.finalUrl);
  const submittedDisplayUrl = redactUrlForDisplay(result.submittedUrl);
  const finalDisplayUrl = redactUrlForDisplay(result.finalUrl);
  const canonicalDisplayUrl =
    result.page.canonicalUrl && result.page.canonicalUrl !== result.finalUrl
      ? redactUrlForDisplay(result.page.canonicalUrl)
      : undefined;

  const reviewLinks = result.links.filter(
    (link) =>
      link.classification === 'suspicious' ||
      link.classification === 'ad-or-tracker' ||
      link.classification === 'known-malicious',
  );

  const flaggedResources = result.resources.filter(
    (resource) =>
      resource.classification !== 'allowed' && resource.classification !== 'unknown',
  );

  const uniqueLimitations = Array.from(
    new Set(
      result.summary.limitations
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );

  if (uniqueLimitations.length === 0) {
    uniqueLimitations.push(DEFAULT_STATIC_LIMITATION);
  }

  return {
    originHost,
    finalHost,
    urlsDiffer: result.submittedUrl !== result.finalUrl,
    submittedDisplayUrl,
    finalDisplayUrl,
    canonicalDisplayUrl,
    hasRedirects: result.redirects.length > 0,
    reviewLinks,
    flaggedResources,
    reviewTotalCount: reviewLinks.length + flaggedResources.length,
    limitations: uniqueLimitations,
  };
}
