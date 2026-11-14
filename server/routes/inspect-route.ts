import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ConcurrencyLimiter,
  SlidingWindowRateLimiter,
} from '../security/request-limits.ts';
import { redactUrlForLog } from '../security/response-sanitizer.ts';
import {
  InspectionStore,
  defaultInspectionStore,
} from '../services/inspection-store.ts';
import {
  inspectUrlTarget,
  type InspectUrlOptions,
} from '../services/redirect-inspector.ts';
import type { FilterSourceManager } from '../services/filter-source-manager.ts';
import { InspectionPolicyError } from '../types/server.ts';

const InspectBodySchema = z.object({
  url: z.string().trim().min(1, 'Masukkan URL situs yang ingin diperiksa.').max(2048),
  options: z
    .object({
      includeStaticLinks: z.boolean().optional(),
      includeResources: z.boolean().optional(),
      enableFilterMatching: z.boolean().optional(),
      warnSuspiciousLinks: z.boolean().optional(),
      rejectProtocolDowngrade: z.boolean().optional(),
      allowlistedHosts: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
    })
    .optional(),
});

const InspectionIdSchema = z.string().uuid();

export interface InspectRouterDependencies {
  store?: InspectionStore;
  concurrencyLimiter?: ConcurrencyLimiter;
  rateLimiter?: SlidingWindowRateLimiter;
  inspectFn?: typeof inspectUrlTarget;
  filterManager?: FilterSourceManager;
  inspectOptions?: Omit<
    InspectUrlOptions,
    | 'signal'
    | 'rejectProtocolDowngrade'
    | 'includeStaticLinks'
    | 'includeResources'
    | 'enableFilterMatching'
    | 'warnSuspiciousLinks'
    | 'allowlistedHosts'
  >;
}

export function createInspectRouter(
  deps: InspectRouterDependencies = {},
): Router {
  const router = Router();
  const store = deps.store ?? defaultInspectionStore;
  const concurrencyLimiter = deps.concurrencyLimiter ?? new ConcurrencyLimiter();
  const rateLimiter = deps.rateLimiter ?? new SlidingWindowRateLimiter();
  const inspectFn = deps.inspectFn ?? inspectUrlTarget;

  router.post('/inspect', async (req: Request, res: Response) => {
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    if (!rateLimiter.allow(clientKey)) {
      res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Terlalu banyak permintaan inspeksi. Coba lagi sebentar lagi.',
      });
      return;
    }

    const parsedBody = InspectBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        code: 'INVALID_URL',
        message: 'Permintaan tidak valid. Periksa kembali URL yang dimasukkan.',
      });
      return;
    }

    if (!concurrencyLimiter.tryAcquire()) {
      res.status(429).json({
        code: 'SERVER_BUSY',
        message: 'Layanan inspeksi sedang sibuk. Silakan coba beberapa saat lagi.',
      });
      return;
    }

    const controller = new AbortController();
    const handleResponseClose = () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    };
    res.on('close', handleResponseClose);

    try {
      const result = await inspectFn(parsedBody.data.url, {
        ...deps.inspectOptions,
        filterEngine:
          deps.inspectOptions?.filterEngine ?? deps.filterManager?.getActiveEngine(),
        includeStaticLinks: parsedBody.data.options?.includeStaticLinks,
        includeResources: parsedBody.data.options?.includeResources,
        enableFilterMatching: parsedBody.data.options?.enableFilterMatching,
        warnSuspiciousLinks: parsedBody.data.options?.warnSuspiciousLinks,
        rejectProtocolDowngrade: parsedBody.data.options?.rejectProtocolDowngrade,
        allowlistedHosts: parsedBody.data.options?.allowlistedHosts,
        signal: controller.signal,
      });

      store.set(result);

      if (!res.writableEnded) {
        res.status(200).json(result);
      }
    } catch (err) {
      if (res.writableEnded || controller.signal.aborted) {
        return;
      }

      if (err instanceof InspectionPolicyError) {
        console.warn('[inspect] rejected', {
          code: err.code,
          url: redactUrlForLog(parsedBody.data.url),
        });
        res.status(err.httpStatus).json({
          code: err.code,
          message: err.message,
        });
        return;
      }

      console.error('[inspect] unexpected error', {
        url: redactUrlForLog(parsedBody.data.url),
      });
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Terjadi kesalahan internal saat memeriksa tautan.',
      });
    } finally {
      res.off('close', handleResponseClose);
      concurrencyLimiter.release();
    }
  });

  router.get('/inspect/:id', (req: Request, res: Response) => {
    const parsedId = InspectionIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      res.status(400).json({
        code: 'INVALID_ID',
        message: 'ID hasil inspeksi tidak valid.',
      });
      return;
    }

    const found = store.get(parsedId.data);
    if (!found) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Hasil inspeksi tidak ditemukan atau sudah kedaluwarsa.',
      });
      return;
    }

    res.status(200).json(found);
  });

  return router;
}
