import { Link, useLocation } from 'react-router-dom';
import { PRIMARY_NAV_ROUTES, isRouteActive } from '../utils/route-meta';

export function NavBottom() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Navigasi bawah seluler"
      className="fixed right-0 bottom-0 left-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-bg)] pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid grid-cols-4">
        {PRIMARY_NAV_ROUTES.map((item) => {
          const active = isRouteActive(pathname, item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[52px] items-center justify-center whitespace-nowrap border-t-2 px-2 text-xs transition-colors duration-150 ${
                active
                  ? 'border-[var(--color-amber)] font-semibold text-[var(--color-text)]'
                  : 'border-transparent font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
