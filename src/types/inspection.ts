export type InspectionStatus = 'idle' | 'loading' | 'success' | 'error';

export type InspectionErrorCode =
  | 'INVALID_URL'
  | 'PROHIBITED_DESTINATION'
  | 'BACKEND_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'ABORTED'
  | 'NOT_FOUND'
  | 'SERVER_ERROR';

export interface InspectionError {
  code: InspectionErrorCode;
  message: string;
}

export interface InspectRequest {
  url: string;
  options?: {
    includeStaticLinks?: boolean;
    includeResources?: boolean;
    enableFilterMatching?: boolean;
    warnSuspiciousLinks?: boolean;
    rejectProtocolDowngrade?: boolean;
    allowlistedHosts?: string[];
  };
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

export interface CdnHostRecord {
  host: string;
  provider: string | null;
  resourceCount: number;
}

export interface InspectionResult {
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
  cdnHosts: CdnHostRecord[];
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
