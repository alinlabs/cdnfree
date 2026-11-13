import { Router } from 'express';
import { SlidingWindowRateLimiter } from '../security/request-limits.ts';
import {
  FilterSourceManager,
  defaultFilterSourceManager,
} from '../services/filter-source-manager.ts';

export function createFiltersRouter(
  manager: FilterSourceManager = defaultFilterSourceManager,
  refreshLimiter: SlidingWindowRateLimiter = new SlidingWindowRateLimiter(60_000, 6),
): Router {
  const router = Router();

  router.get('/filters/status', (_req, res) => {
    res.json(manager.getStatusSnapshot());
  });

  router.post('/filters/refresh', async (req, res) => {
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    if (!refreshLimiter.allow(clientKey)) {
      res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Terlalu banyak permintaan pembaruan daftar filter. Coba lagi sebentar lagi.',
      });
      return;
    }

    try {
      const summary = await manager.refreshAll();
      res.status(200).json(summary);
    } catch {
      res.status(500).json({
        code: 'FILTER_REFRESH_FAILED',
        message: 'Terjadi kesalahan saat memperbarui daftar filter di server.',
      });
    }
  });

  return router;
}
