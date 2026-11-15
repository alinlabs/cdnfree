import { classifyResourceKind } from '../../src/utils/classify-resource.ts';
import {
  InspectionPolicyError,
  type ResourceRecord,
} from '../types/server.ts';
import { classifyAsset } from './asset-classify.ts';

export interface FallbackResourceDescriptor {
  url: string;
  referer?: string;
  kind?: ResourceRecord['kind'];
  assetKind?: ResourceRecord['assetKind'];
  mimeType?: string;
}

export function validateResourceDownloadEligibility(
  resource: ResourceRecord,
): void {
  if (resource.observation === 'blocked') {
    throw new InspectionPolicyError(
      'PROHIBITED_DESTINATION',
      'Aset tidak dapat diunduh karena ditandai diblokir oleh kebijakan inspeksi.',
      403,
    );
  }

  if (resource.classification === 'known-malicious') {
    throw new InspectionPolicyError(
      'PROHIBITED_DESTINATION',
      'Aset tidak dapat diunduh karena cocok dengan indikator berisiko tinggi.',
      403,
    );
  }

  if (resource.classification === 'ad-or-tracker') {
    throw new InspectionPolicyError(
      'PROHIBITED_DESTINATION',
      'Aset tidak dapat diunduh karena cocok dengan aturan daftar filter iklan atau pelacak.',
      403,
    );
  }

  if (
    resource.assetKind === 'wrapper' ||
    resource.probe?.reason === 'html-wrapper'
  ) {
    throw new InspectionPolicyError(
      'UNSUPPORTED_CONTENT_TYPE',
      'URL ini mengarah ke halaman pembungkus HTML, bukan file media langsung.',
      415,
    );
  }

  const mime = (resource.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const isPdf =
    mime === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(resource.url);
  const isPlaylist =
    resource.assetKind === 'hls' ||
    resource.assetKind === 'dash' ||
    /\.m3u8(?:$|[?#])/i.test(resource.url);

  if (
    !isPlaylist &&
    ((resource.kind === 'document' && !isPdf) || resource.kind === 'script')
  ) {
    throw new InspectionPolicyError(
      'UNSUPPORTED_CONTENT_TYPE',
      'Aset bertipe halaman HTML atau skrip tidak tersedia untuk pengunduhan langsung.',
      403,
    );
  }
}

export function synthesizeFallbackDownloadResource(
  resourceId: string,
  descriptor?: FallbackResourceDescriptor,
): ResourceRecord | undefined {
  if (!descriptor?.url) return undefined;

  let parsedUrl: URL;
  try {
    const candidate = new URL(descriptor.url);
    if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') {
      return undefined;
    }
    parsedUrl = candidate;
  } catch {
    return undefined;
  }

  let safeReferer: string | undefined;
  if (descriptor.referer) {
    try {
      const refUrl = new URL(descriptor.referer);
      if (refUrl.protocol === 'http:' || refUrl.protocol === 'https:') {
        safeReferer = refUrl.href;
      }
    } catch {
      safeReferer = undefined;
    }
  }

  const inferredAssetKind =
    descriptor.assetKind ??
    classifyAsset({
      url: parsedUrl.href,
      mime: descriptor.mimeType,
    });
  const inferredKind =
    descriptor.kind ??
    classifyResourceKind(parsedUrl.href, {
      mimeHint: descriptor.mimeType,
    });

  return {
    id: resourceId,
    url: parsedUrl.href,
    host: parsedUrl.hostname.toLowerCase(),
    kind: inferredKind,
    assetKind: inferredAssetKind,
    mimeType: descriptor.mimeType,
    referer: safeReferer,
    source: 'html-link',
    observation: 'discovered',
    classification: 'allowed',
  };
}
