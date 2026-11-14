import { useState } from 'react';
import type { LinkRecord, ResourceRecord } from '../../../types/inspection';
import {
  getResourceKindLabelId,
  getReviewClassificationLabel,
} from '../../../utils/inspection-details';

interface ReviewFindingsSectionProps {
  reviewLinks: LinkRecord[];
  flaggedResources: ResourceRecord[];
  totalCount: number;
}

const INITIAL_REVIEW_ITEM_LIMIT = 8;

export function ReviewFindingsSection({
  reviewLinks,
  flaggedResources,
  totalCount,
}: ReviewFindingsSectionProps) {
  const [showAllReviewItems, setShowAllReviewItems] = useState(false);

  const visibleReviewLinks = showAllReviewItems
    ? reviewLinks
    : reviewLinks.slice(0, INITIAL_REVIEW_ITEM_LIMIT);
  const visibleFlaggedResources = showAllReviewItems
    ? flaggedResources
    : flaggedResources.slice(0, INITIAL_REVIEW_ITEM_LIMIT);

  return (
    <section
      aria-labelledby="temuan-tinjau-heading"
      className="space-y-3 border-b border-[var(--color-border)] pb-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="temuan-tinjau-heading"
          className="text-base font-semibold text-[var(--color-text)]"
        >
          Perlu ditinjau
        </h2>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {totalCount} temuan
        </span>
      </div>

      {totalCount === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Tidak ada tautan atau aset statis yang memicu penandaan risiko atau daftar filter pada halaman ini.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          {visibleReviewLinks.length > 0 ? (
            <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {visibleReviewLinks.map((link) => (
                <li key={link.id} className="space-y-1 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-all font-medium text-[var(--color-text)]">
                      {link.host}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-[var(--color-danger)]">
                      {getReviewClassificationLabel(link.classification)}
                    </span>
                  </div>
                  {link.evidence && link.evidence.length > 0 ? (
                    <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                      {link.evidence[0]}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {visibleFlaggedResources.length > 0 ? (
            <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {visibleFlaggedResources.map((resource) => (
                <li key={resource.id} className="space-y-1 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-all font-medium text-[var(--color-text)]">
                      {resource.host} · {getResourceKindLabelId(resource.kind)}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-[var(--color-danger)]">
                      {getReviewClassificationLabel(resource.classification)}
                    </span>
                  </div>
                  {resource.reason ? (
                    <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                      {resource.reason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {reviewLinks.length > INITIAL_REVIEW_ITEM_LIMIT ||
          flaggedResources.length > INITIAL_REVIEW_ITEM_LIMIT ? (
            <button
              type="button"
              onClick={() => setShowAllReviewItems((prev) => !prev)}
              className="text-xs font-medium text-[var(--color-amber-strong)] underline-offset-4 hover:underline"
            >
              {showAllReviewItems
                ? 'Tampilkan lebih sedikit'
                : `Tampilkan semua temuan (${totalCount})`}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
