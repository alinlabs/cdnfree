import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bookmark, ChevronLeft, History, Settings } from 'lucide-react';
import {
  MarkahHeaderSearch,
  MarkahHeaderToolbar,
} from '../pages/markah/markah-toolbar';
import {
  HistoryHeaderSearch,
  HistoryHeaderToolbar,
} from '../pages/riwayat-pencarian/history-toolbar';
import { isRouteActive } from '../utils/route-meta';
import { BrandWordmark } from './brand-wordmark';
import { useNavHeaderContext } from './nav-header-context';
import { PageContainer } from './page-container';

interface SubpageHeaderMeta {
  title: string;
  subtitle: string;
}

function resolveSubpageHeaderMeta(pathname: string): SubpageHeaderMeta | null {
  if (isRouteActive(pathname, '/markah')) {
    return {
      title: 'Markah media',
      subtitle: 'Koleksi tautan gambar & video lokal',
    };
  }
  if (isRouteActive(pathname, '/riwayat-pencarian')) {
    return {
      title: 'Riwayat pencarian',
      subtitle: 'Daftar tautan tersimpan di peramban',
    };
  }
  if (isRouteActive(pathname, '/pengaturan')) {
    return {
      title: 'Pengaturan',
      subtitle: 'Tema, inspeksi, filter & privasi lokal',
    };
  }
  return null;
}

export function NavHeader() {
  const { pathname } = useLocation();
  const { markahControls, historyControls } = useNavHeaderContext();
  const isHome = isRouteActive(pathname, '/');
  const isMarkah = isRouteActive(pathname, '/markah');
  const isHistory = isRouteActive(pathname, '/riwayat-pencarian');
  const subpageMeta = resolveSubpageHeaderMeta(pathname);
  const [markahSearchOpen, setMarkahSearchOpen] = useState(false);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);

  useEffect(() => {
    if (!isMarkah) {
      setMarkahSearchOpen(false);
    } else if (markahControls?.query.trim()) {
      setMarkahSearchOpen(true);
    }
  }, [isMarkah, markahControls?.query]);

  useEffect(() => {
    if (!isHistory) {
      setHistorySearchOpen(false);
    } else if (historyControls?.query.trim()) {
      setHistorySearchOpen(true);
    }
  }, [isHistory, historyControls?.query]);

  const showMarkahControls = Boolean(isMarkah && markahControls);
  const showHistoryControls = Boolean(isHistory && historyControls);

  return (
    <header className="relative z-30 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      <PageContainer className="py-2.5 sm:py-3">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          {subpageMeta ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <div className="flex shrink-0 items-center gap-1">
                <Link
                  to="/"
                  aria-label="Kembali ke Beranda"
                  title="Kembali ke Beranda"
                  className="inline-flex h-8 w-6 -ml-1 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:text-[var(--color-text)]"
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </Link>

                <div className="hidden sm:flex">
                  <BrandWordmark size="md" />
                </div>
              </div>

              {showMarkahControls && markahControls && markahSearchOpen ? (
                <MarkahHeaderSearch
                  query={markahControls.query}
                  onQueryChange={markahControls.onQueryChange}
                  onCloseSearch={() => setMarkahSearchOpen(false)}
                />
              ) : showHistoryControls && historyControls && historySearchOpen ? (
                <HistoryHeaderSearch
                  query={historyControls.query}
                  onQueryChange={historyControls.onQueryChange}
                  onCloseSearch={() => setHistorySearchOpen(false)}
                />
              ) : (
                <Link
                  to="/"
                  aria-label="Kembali ke Beranda"
                  title="Kembali ke Beranda"
                  className="group flex min-h-9 min-w-0 flex-1 flex-col justify-center pl-1 text-left no-underline transition-colors duration-150 sm:border-l sm:border-[var(--color-border)] sm:pl-3"
                >
                  <h1 className="block truncate text-sm font-semibold leading-tight text-[var(--color-text)] transition-colors duration-150 group-hover:text-[var(--color-amber-strong)]">
                    {subpageMeta.title}
                  </h1>
                  <p className="block truncate text-xs leading-tight text-[var(--color-text-soft)]">
                    {subpageMeta.subtitle}
                  </p>
                </Link>
              )}
            </div>
          ) : (
            <div className="flex min-h-9 items-center">
              <BrandWordmark size="md" />
            </div>
          )}

          {isHome ? (
            <nav aria-label="Akses cepat" className="flex shrink-0 items-center gap-1">
              <Link
                to="/riwayat-pencarian"
                aria-label="Riwayat pencarian"
                title="Riwayat pencarian"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
              >
                <History size={18} aria-hidden="true" />
              </Link>

              <Link
                to="/markah"
                aria-label="Markah media"
                title="Markah media"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
              >
                <Bookmark size={18} aria-hidden="true" />
              </Link>

              <Link
                to="/pengaturan"
                aria-label="Pengaturan"
                title="Pengaturan"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
              >
                <Settings size={18} aria-hidden="true" />
              </Link>
            </nav>
          ) : showMarkahControls && markahControls ? (
            <MarkahHeaderToolbar
              controls={markahControls}
              searchOpen={markahSearchOpen}
              onOpenSearch={() => setMarkahSearchOpen(true)}
            />
          ) : showHistoryControls && historyControls ? (
            <HistoryHeaderToolbar
              controls={historyControls}
              searchOpen={historySearchOpen}
              onOpenSearch={() => setHistorySearchOpen(true)}
            />
          ) : null}
        </div>
      </PageContainer>
    </header>
  );
}
