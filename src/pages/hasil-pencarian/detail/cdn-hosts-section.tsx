import { useState } from 'react';
import type { CdnHostRecord } from '../../../types/inspection';

interface CdnHostsSectionProps {
  cdnHosts: CdnHostRecord[];
}

const INITIAL_CDN_HOST_LIMIT = 12;

export function CdnHostsSection({ cdnHosts }: CdnHostsSectionProps) {
  const [showAllHosts, setShowAllHosts] = useState(false);

  const visibleCdnHosts = showAllHosts
    ? cdnHosts
    : cdnHosts.slice(0, INITIAL_CDN_HOST_LIMIT);

  return (
    <section
      aria-labelledby="cdn-host-heading"
      className="space-y-3 border-b border-[var(--color-border)] pb-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="cdn-host-heading"
          className="text-base font-semibold text-[var(--color-text)]"
        >
          CDN & host aset
        </h2>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {cdnHosts.length} host
        </span>
      </div>

      {cdnHosts.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Belum ada host aset terpisah yang terdeteksi dari HTML statis.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] text-sm">
            {visibleCdnHosts.map((item) => (
              <li
                key={item.host}
                className="flex items-start justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="break-all font-medium text-[var(--color-text)]">
                    {item.host}
                  </p>
                  {item.provider ? (
                    <p className="text-xs text-[var(--color-text-soft)]">
                      Penyedia teridentifikasi: {item.provider}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 tabular-nums text-xs text-[var(--color-text-muted)]">
                  {item.resourceCount} aset
                </span>
              </li>
            ))}
          </ul>

          {cdnHosts.length > INITIAL_CDN_HOST_LIMIT ? (
            <button
              type="button"
              onClick={() => setShowAllHosts((prev) => !prev)}
              className="text-xs font-medium text-[var(--color-amber-strong)] underline-offset-4 hover:underline"
            >
              {showAllHosts
                ? 'Tampilkan lebih sedikit'
                : `Tampilkan semua (${cdnHosts.length} host)`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
