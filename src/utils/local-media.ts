export const LOCAL_MEDIA_HOST_LABEL = 'Aset bawaan';

const BUNDLED_MEDIA_PATH_PATTERN =
  /^\/(?:logo\.webp|(?:src\/)?assets\/[a-zA-Z0-9._/-]+\.(?:mp4|m4v|webm|ogv|ogg|mov|webp|png|jpg|jpeg|avif|svg))$/;

export function isLocalAppMediaUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return false;
  }
  const pathOnly = trimmed.split(/[?#]/)[0] ?? '';
  if (pathOnly.includes('..') || pathOnly.includes('\\')) {
    return false;
  }
  return BUNDLED_MEDIA_PATH_PATTERN.test(pathOnly);
}

export function normalizeLocalAppMediaUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const hashIndex = trimmed.indexOf('#');
  return hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
}

export function resolveCopyableMediaUrl(rawUrl: string): string {
  if (isLocalAppMediaUrl(rawUrl) && typeof window !== 'undefined') {
    return `${window.location.origin}${rawUrl}`;
  }
  return rawUrl;
}
