import { z } from 'zod';
import type {
  InspectRequest,
  InspectionError,
  InspectionResult,
} from '../types/inspection';

const RedirectHopSchema = z.object({
  step: z.number(),
  url: z.string(),
  host: z.string(),
  statusCode: z.number(),
  reason: z.string().optional(),
});

const ResourceRecordSchema = z.object({
  id: z.string(),
  url: z.string(),
  host: z.string(),
  kind: z.enum([
    'image',
    'video',
    'audio',
    'script',
    'stylesheet',
    'font',
    'document',
    'other',
  ]),
  mimeType: z.string().optional(),
  declaredBytes: z.number().optional(),
  posterUrl: z.string().optional(),
  source: z.enum([
    'html-img',
    'html-video',
    'html-audio',
    'html-script',
    'html-link',
    'html-source',
    'css-reference',
    'browser-observed',
  ]),
  observation: z.enum(['discovered', 'fetched', 'blocked', 'unknown']),
  classification: z.enum([
    'allowed',
    'ad-or-tracker',
    'suspicious',
    'known-malicious',
    'unknown',
  ]),
  reason: z.string().optional(),
});

const LinkRecordSchema = z.object({
  id: z.string(),
  href: z.string(),
  host: z.string(),
  text: z.string().optional(),
  rel: z.string().optional(),
  classification: z.enum([
    'ordinary',
    'ad-or-tracker',
    'suspicious',
    'known-malicious',
    'unknown',
  ]),
  evidence: z.array(z.string()).optional(),
});

const CdnHostSchema = z.object({
  host: z.string(),
  provider: z.string().nullable(),
  resourceCount: z.number(),
});

export const InspectionResultSchema: z.ZodType<InspectionResult> = z.object({
  id: z.string(),
  submittedUrl: z.string(),
  finalUrl: z.string(),
  page: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    canonicalUrl: z.string().optional(),
    statusCode: z.number(),
    contentType: z.string(),
    isIdn: z.boolean(),
    metaRefreshHint: z
      .object({
        delaySeconds: z.number().optional(),
        targetUrl: z.string().optional(),
        rawContent: z.string(),
        unsafeTargetRejected: z.boolean().optional(),
      })
      .optional(),
  }),
  redirects: z.array(RedirectHopSchema),
  resources: z.array(ResourceRecordSchema),
  links: z.array(LinkRecordSchema),
  cdnHosts: z.array(CdnHostSchema),
  summary: z.object({
    inspectedAt: z.string(),
    durationMs: z.number(),
    redirectCount: z.number(),
    resourceCount: z.number(),
    blockedCount: z.number(),
    flaggedCount: z.number(),
    reviewCount: z.number(),
    unsafeSchemeCount: z.number(),
    limitations: z.array(z.string()),
  }),
  preview: z.object({
    mode: z.enum(['embeddable', 'external-only', 'unsupported']),
    reason: z.string().optional(),
  }),
});

export type InspectionApiOutcome =
  | { ok: true; result: InspectionResult }
  | { ok: false; error: InspectionError };

function mapApiError(status: number, payload: unknown): InspectionError {
  const serverMessage =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { message?: unknown }).message === 'string'
      ? (payload as { message: string }).message
      : 'Tidak dapat memeriksa situs ini.';

  const serverCode =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { code?: unknown }).code === 'string'
      ? (payload as { code: string }).code
      : '';

  if (status === 404 && serverCode === 'NOT_FOUND') {
    return { code: 'NOT_FOUND', message: serverMessage };
  }
  if (status === 403 || serverCode === 'PROHIBITED_DESTINATION') {
    return { code: 'PROHIBITED_DESTINATION', message: serverMessage };
  }
  if (status === 400 && serverCode === 'INVALID_URL') {
    return { code: 'INVALID_URL', message: serverMessage };
  }
  return { code: 'SERVER_ERROR', message: serverMessage };
}

export async function submitInspectionRequest(
  request: InspectRequest,
  signal?: AbortSignal,
): Promise<InspectionApiOutcome> {
  try {
    const response = await fetch('/api/inspect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
      signal,
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      if (response.status === 504) {
        return {
          ok: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'Permintaan pemeriksaan melebihi batas waktu server. Coba lagi.',
          },
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'Terlalu banyak permintaan inspeksi. Tunggu sebentar lalu coba lagi.',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'BACKEND_UNAVAILABLE',
          message: 'Layanan inspeksi server tidak merespons dengan format yang valid.',
        },
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Respons layanan inspeksi tidak dapat dibaca sebagai JSON yang valid.',
        },
      };
    }

    if (!response.ok) {
      return { ok: false, error: mapApiError(response.status, payload) };
    }

    const parsed = InspectionResultSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Respons layanan inspeksi tidak sesuai skema yang diharapkan.',
        },
      };
    }

    return { ok: true, result: parsed.data };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        error: {
          code: 'ABORTED',
          message: 'Pemeriksaan tautan dibatalkan.',
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Tidak dapat terhubung ke layanan inspeksi. Periksa koneksi Anda.',
      },
    };
  }
}

export async function getInspectionById(
  id: string,
  signal?: AbortSignal,
): Promise<InspectionApiOutcome> {
  try {
    const response = await fetch(`/api/inspect/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      if (response.status === 504) {
        return {
          ok: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'Waktu pengambilan hasil inspeksi habis. Memeriksa ulang tautan...',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'BACKEND_UNAVAILABLE',
          message: 'Layanan inspeksi server tidak tersedia.',
        },
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Format data inspeksi tidak valid.',
        },
      };
    }
    if (!response.ok) {
      return { ok: false, error: mapApiError(response.status, payload) };
    }

    const parsed = InspectionResultSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Format data inspeksi tidak valid.',
        },
      };
    }

    return { ok: true, result: parsed.data };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        error: {
          code: 'ABORTED',
          message: 'Permintaan dibatalkan.',
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Tidak dapat mengambil hasil inspeksi dari server.',
      },
    };
  }
}

const CapturedAssetsResponseSchema = z.object({
  sid: z.string(),
  resources: z.array(ResourceRecordSchema),
});

export async function fetchCapturedAssets(
  sessionId: string,
  signal?: AbortSignal,
): Promise<InspectionResult['resources']> {
  try {
    const response = await fetch(
      `/api/captured?sid=${encodeURIComponent(sessionId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      },
    );
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    const parsed = CapturedAssetsResponseSchema.safeParse(payload);
    return parsed.success ? parsed.data.resources : [];
  } catch {
    return [];
  }
}
