import { useMemo, useState } from 'react';
import { Check, Copy, Search } from 'lucide-react';
import { ExternalLinkAction } from '../../../components/external-link-action';
import type { LinkRecord } from '../../../types/inspection';
import { redactUrlForDisplay } from '../../../utils/redact-url';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import {
  filterPageLinks,
  getLinkClassificationBadge,
  type LinkFilterMode,
} from './detail-labels';

interface SuspiciousLinksProps {
  links: LinkRecord[];
}

const PAGE_SIZE = 25;

export function SuspiciousLinks({ links }: SuspiciousLinksProps) {
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<LinkFilterMode>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { isCopied, copyText } = useCopyFeedback();

  const filteredLinks = useMemo(
    () => filterPageLinks(links, query, filterMode),
    [links, query, filterMode],
  );

  const visibleLinks = filteredLinks.slice(0, visibleCount);
  const hasMore = visibleLinks.length < filteredLinks.length;

  return (
    <section aria-labelledby="tautan-halaman-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="tautan-halaman-heading"
          className="text-base font-semibold text-[var(--color-text)]"
        >
          Tautan pada halaman
        </h2>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {filteredLinks.length} dari {links.length} tautan
        </span>
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Tidak ada tautan jangkar statis yang ditemukan pada dokumen HTML ini.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-text-soft)]"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                placeholder="Cari teks tautan, domain, atau URL..."
                aria-label="Cari tautan pada halaman"
                className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pr-3 pl-9 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-soft)]"
              />
            </div>

            <select
              value={filterMode}
              onChange={(event) => {
                setFilterMode(event.target.value as LinkFilterMode);
                setVisibleCount(PAGE_SIZE);
              }}
              aria-label="Filter klasifikasi tautan"
              className="h-10 min-w-0 max-w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            >
              <option value="all">Semua klasifikasi</option>
              <option value="review">Perlu ditinjau</option>
              <option value="ad-or-tracker">Iklan atau pelacak</option>
              <option value="ordinary">Tautan biasa</option>
              <option value="unknown">Tidak diketahui</option>
            </select>
          </div>

          {filteredLinks.length === 0 ? (
            <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-sm text-[var(--color-text-muted)]">
              Tidak ada tautan yang cocok dengan kata kunci atau filter tersebut.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {visibleLinks.map((link) => {
                const statusInfo = getLinkClassificationBadge(link.classification);
                const isFlagged =
                  link.classification === 'suspicious' ||
                  link.classification === 'ad-or-tracker' ||
                  link.classification === 'known-malicious';
                const copied = isCopied(link.id);

                return (
                  <li key={link.id} className="space-y-1.5 py-3.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="min-w-0 break-words text-sm font-medium text-[var(--color-text)]">
                        {link.text?.trim() || '(Tanpa teks tautan)'}
                      </span>
                      <span className={`text-xs ${statusInfo.toneClass}`}>
                        {statusInfo.text}
                      </span>
                    </div>

                    <p className="break-all text-xs text-[var(--color-text-muted)] tabular-nums">
                      {redactUrlForDisplay(link.href)}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-soft)]">
                      <span className="break-all">Host: {link.host}</span>
                      {link.rel ? <span>rel: {link.rel}</span> : null}
                    </div>

                    {link.evidence && link.evidence.length > 0 ? (
                      <ul className="list-disc space-y-0.5 pl-4 text-xs text-[var(--color-text-muted)]">
                        {link.evidence.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          void copyText(link.href, link.id);
                        }}
                        className="inline-flex min-h-[36px] items-center gap-1 py-1 text-xs font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:text-[var(--color-text)]"
                      >
                        {copied ? (
                          <>
                            <Check size={13} aria-hidden="true" className="text-[var(--color-success)]" />
                            <span>Tersalin</span>
                          </>
                        ) : (
                          <>
                            <Copy size={13} aria-hidden="true" />
                            <span>Salin URL</span>
                          </>
                        )}
                      </button>

                      <ExternalLinkAction
                        url={link.href}
                        label={isFlagged ? 'Buka dengan peringatan' : 'Buka tautan'}
                        warningText={
                          isFlagged && link.evidence && link.evidence.length > 0
                            ? link.evidence.join(' ')
                            : undefined
                        }
                        variant="text"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore ? (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
              >
                Tampilkan lebih banyak ({filteredLinks.length - visibleLinks.length} tersisa)
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
