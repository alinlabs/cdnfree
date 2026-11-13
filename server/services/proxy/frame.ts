import type { Request, Response } from 'express';

export const FRAME_ANCESTORS = [
  "'self'",
  'https://aistudio.google.com',
  'https://*.googleusercontent.com',
  'https://*.run.app',
  'https://*.vercel.app',
  'https://*.web.app',
].join(' ');

export function setFrameable(res: Response): void {
  res.removeHeader('x-frame-options');
  res.removeHeader('content-security-policy');
  res.removeHeader('content-security-policy-report-only');

  res.setHeader('Content-Security-Policy', `frame-ancestors ${FRAME_ANCESTORS}`);
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

export function derivePublicOrigin(req: Request): string {
  const protoHeader = req.headers['x-forwarded-proto'];
  const rawProto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  const proto = rawProto ? rawProto.split(',')[0].trim() : req.protocol || 'https';

  const fwdHostHeader = req.headers['x-forwarded-host'];
  const rawFwdHost = Array.isArray(fwdHostHeader) ? fwdHostHeader[0] : fwdHostHeader;
  const fwdHost = rawFwdHost ? rawFwdHost.split(',')[0].trim() : '';

  const rawHostHeader = Array.isArray(req.headers.host)
    ? req.headers.host[0]
    : req.headers.host;
  const directHost = rawHostHeader ? rawHostHeader.split(',')[0].trim() : '';

  // Never trust Origin header; prefer forwarded public host and reject empty/localhost when forwarded host is missing unless in explicit local dev.
  const chosenHost =
    fwdHost && !fwdHost.startsWith('localhost')
      ? fwdHost
      : directHost;

  if (!chosenHost) {
    throw new Error('bad_origin');
  }

  return `${proto}://${chosenHost}`;
}
