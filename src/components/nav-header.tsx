import { Link, useLocation } from 'react-router-dom';
import { Bookmark, History, Settings } from 'lucide-react';
import { BrandWordmark } from './brand-wordmark';
import { PageContainer } from './page-container';
import { isRouteActive } from '../utils/route-meta';

export function NavHeader() {
  const { pathname } = useLocation();
  const isHistoryActive = isRouteActive(pathname, '/riwayat-pencarian');
  const isMarkahActive = isRouteActive(pathname, '/markah');
  const isSettingsActive = isRouteActive(pathname, '/pengaturan');

  return (
    <header className="relative z-30 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      <PageContainer>
        <div className="flex h-14 md:h-16 items-center justify-between gap-4">
          <BrandWordmark size="md" />

          <nav aria-label="Akses cepat" className="flex items-center gap-1.5 shrink-0">
            <Link
              to="/riwayat-pencarian"
              aria-label="Riwayat pencarian"
              title="Riwayat pencarian"
              aria-current={isHistoryActive ? 'page' : undefined}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
                isHistoryActive
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
              }`}
            >
              <History size={18} aria-hidden="true" />
            </Link>

            <Link
              to="/markah"
              aria-label="Markah media"
              title="Markah media"
              aria-current={isMarkahActive ? 'page' : undefined}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
                isMarkahActive
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
              }`}
            >
              <Bookmark
                size={18}
                aria-hidden="true"
                className={isMarkahActive ? 'fill-current' : ''}
              />
            </Link>

            <Link
              to="/pengaturan"
              aria-label="Pengaturan"
              title="Pengaturan"
              aria-current={isSettingsActive ? 'page' : undefined}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
                isSettingsActive
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
              }`}
            >
              <Settings size={18} aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </PageContainer>
    </header>
  );
}
