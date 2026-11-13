export function encodeProxyUrlClient(absUrl: string): string {
  const bytes = new TextEncoder().encode(absUrl);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function buildProxyFrameUrl(
  targetUrl: string,
  sessionId?: string,
): string {
  const qs = `u=${encodeProxyUrlClient(targetUrl)}${
    sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
  }`;
  return `/api/proxy?${qs}`;
}

export function buildProxyAssetUrl(
  targetUrl: string,
  sessionId?: string,
): string {
  const qs = `u=${encodeProxyUrlClient(targetUrl)}${
    sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
  }`;
  return `/api/asset?${qs}`;
}

export function buildFullViewerUrl(
  targetUrl: string,
  sessionId?: string,
): string {
  const qs = `u=${encodeProxyUrlClient(targetUrl)}${
    sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
  }`;
  return `/view?${qs}`;
}
