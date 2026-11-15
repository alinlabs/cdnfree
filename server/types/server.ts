export interface DnsAddressRecord {
  address: string;
  family: 4 | 6;
}

export type DnsLookupFn = (hostname: string) => Promise<DnsAddressRecord[]>;

export type ServerInspectionErrorCode =
  | 'INVALID_URL'
  | 'PROHIBITED_DESTINATION'
  | 'DNS_RESOLUTION_FAILED'
  | 'TOO_MANY_REDIRECTS'
  | 'REDIRECT_LOOP'
  | 'INVALID_REDIRECT'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'RESPONSE_TOO_LARGE'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'UPSTREAM_ERROR';

export class InspectionPolicyError extends Error {
  readonly code: ServerInspectionErrorCode;
  readonly httpStatus: number;

  constructor(
    code: ServerInspectionErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(message);
    this.name = 'InspectionPolicyError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface RedirectHopRecord {
  step: number;
  url: string;
  host: string;
  statusCode: number;
  reason?: string;
}

export type AssetKind =
  | 'image'
  | 'vector'
  | 'video'
  | 'audio'
  | 'font'
  | 'stylesheet'
  | 'pdf'
  | 'json'
  | 'other';

export interface AssetProbeInfo {
  status: 'verified' | 'unverified';
  reason:
    | 'ok'
    | 'http-403'
    | 'http-4xx'
    | 'http-5xx'
    | 'timeout'
    | 'network'
    | 'ssrf-blocked';
  httpStatus?: number;
  mime?: string;
  bytes?: number;
  ranges?: boolean;
}

export interface ExtractionTelemetry {
  candidates: number;
  resolved: number;
  deduped: number;
  byKind: Record<AssetKind, number>;
  dropped: Array<{
    reason: 'unresolvable' | 'scheme' | 'duplicate' | 'budget';
    count: number;
  }>;
  verifiedCount: number;
  unverifiedCount: number;
}

export interface ResourceRecord {
  id: string;
  url: string;
  host: string;
  kind:
    | 'image'
    | 'video'
    | 'audio'
    | 'script'
    | 'stylesheet'
    | 'font'
    | 'document'
    | 'other';
  assetKind?: AssetKind;
  mimeType?: string;
  declaredBytes?: number;
  posterUrl?: string;
  streamUrl?: string;
  probe?: AssetProbeInfo | null;
  source:
    | 'html-img'
    | 'html-video'
    | 'html-audio'
    | 'html-script'
    | 'html-link'
    | 'html-source'
    | 'css-reference'
    | 'browser-observed';
  observation: 'discovered' | 'fetched' | 'blocked' | 'unknown';
  classification:
    | 'allowed'
    | 'ad-or-tracker'
    | 'suspicious'
    | 'known-malicious'
    | 'unknown';
  reason?: string;
}

export interface LinkRecord {
  id: string;
  href: string;
  host: string;
  text?: string;
  rel?: string;
  classification:
    | 'ordinary'
    | 'ad-or-tracker'
    | 'suspicious'
    | 'known-malicious'
    | 'unknown';
  evidence?: string[];
}

export interface ServerInspectionResult {
  id: string;
  submittedUrl: string;
  finalUrl: string;
  page: {
    title?: string;
    description?: string;
    canonicalUrl?: string;
    statusCode: number;
    contentType: string;
    isIdn: boolean;
    metaRefreshHint?: {
      delaySeconds?: number;
      targetUrl?: string;
      rawContent: string;
      unsafeTargetRejected?: boolean;
    };
  };
  redirects: RedirectHopRecord[];
  resources: ResourceRecord[];
  links: LinkRecord[];
  cdnHosts: Array<{
    host: string;
    provider: string | null;
    resourceCount: number;
  }>;
  extraction?: ExtractionTelemetry;
  summary: {
    inspectedAt: string;
    durationMs: number;
    redirectCount: number;
    resourceCount: number;
    blockedCount: number;
    flaggedCount: number;
    reviewCount: number;
    unsafeSchemeCount: number;
    limitations: string[];
  };
  preview: {
    mode: 'embeddable' | 'external-only' | 'unsupported';
    reason?: string;
  };
}
