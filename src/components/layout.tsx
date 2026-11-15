import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { shouldShowGlobalNav } from '../utils/route-meta';
import { Footer } from './footer';
import { NavHeader } from './nav-header';

import { NavHeaderProvider } from './nav-header-context';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { pathname } = useLocation();
  const showGlobalNav = shouldShowGlobalNav(pathname);
  const isResultsRoute = !showGlobalNav;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [pathname]);

  return (
    <NavHeaderProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--color-text)]"
        >
          Lewati ke konten utama
        </a>

        {!isResultsRoute ? (
          <>
            <NavHeader />

            <div
              ref={scrollContainerRef}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto"
            >
              <main id="main-content" className="flex flex-1 flex-col">
                {children}
              </main>
              <Footer />
            </div>
          </>
        ) : (
          <main
            id="main-content"
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {children}
          </main>
        )}
      </div>
    </NavHeaderProvider>
  );
}
