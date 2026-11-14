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
  mimeType?: string;
  declaredBytes?: number;
  posterUrl?: string;
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
