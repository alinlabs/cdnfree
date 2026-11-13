import type { ResourceRecord } from '../types/inspection.ts';
import { isProhibitedHostname } from './normalize-url.ts';

export interface SafeExternalUrlResult {
  safe: boolean;
  url: string | null;
  host: string | null;
  reason?: string;
}

export function validateExternalNavigationUrl(rawUrl: string): SafeExternalUrlResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      safe: false,
      url: null,
      host: null,
      reason: 'Alamat tautan kosong.',
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        safe: false,
        url: null,
        host: null,
        reason: `Skema ${parsed.protocol} tidak diizinkan untuk dibuka secara langsung.`,
      };
    }

    if (parsed.username || parsed.password) {
      return {
        safe: false,
        url: null,
        host: null,
        reason: 'Tautan yang menyertakan kredensial tidak diizinkan.',
      };
    }

    return {
      safe: true,
      url: parsed.toString(),
      host: parsed.hostname,
    };
  } catch {
    return {
      safe: false,
      url: null,
      host: null,
      reason: 'Format URL tujuan tidak valid.',
    };
  }
}

export interface AssetDownloadEligibility {
  eligible: boolean;
  label: string;
  reason: string;
}

export function getAssetDownloadEligibility(
  resource: ResourceRecord,
): AssetDownloadEligibility {
  const validated = validateExternalNavigationUrl(resource.url);
  if (!validated.safe) {
    return {
      eligible: false,
      label: 'Tidak memenuhi syarat',
      reason: validated.reason ?? 'Skema URL tidak didukung.',
    };
  }

  if (validated.host && isProhibitedHostname(validated.host)) {
    return {
      eligible: false,
      label: 'Alamat dibatasi',
      reason: 'Aset mengarah ke alamat lokal atau jaringan privat dan tidak dapat diunduh.',
    };
  }

  if (resource.observation === 'blocked') {
    return {
      eligible: false,
      label: 'Dibatasi',
      reason: 'Aset ditandai diblokir dan tidak layak diunduh.',
    };
  }

  if (resource.classification === 'known-malicious') {
    return {
      eligible: false,
      label: 'Berisiko tinggi',
      reason: 'Aset cocok dengan indikator berbahaya sehingga unduhan dinonaktifkan.',
    };
  }

  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const isPdf =
    mime === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(resource.url);

  if ((resource.kind === 'document' && !isPdf) || resource.kind === 'script') {
    return {
      eligible: false,
      label: 'Hanya pratinjau metadata',
      reason: 'Halaman HTML dan skrip tidak disediakan sebagai unduhan aset langsung.',
    };
  }

  if (resource.classification === 'ad-or-tracker') {
    return {
      eligible: false,
      label: 'Dibatasi filter',
      reason: 'Aset terdeteksi sebagai iklan atau pelacak.',
    };
  }

  return {
    eligible: true,
    label: 'Layak diunduh (aset publik)',
    reason: 'URL publik memenuhi kriteria awal untuk validasi unduhan pengguna.',
  };
}
