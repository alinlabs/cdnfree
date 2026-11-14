import { Globe } from 'lucide-react';
import { ExternalLinkAction } from '../../../components/external-link-action';

interface WebFallbackCardProps {
  heading: string;
  description: string;
  detailReason?: string;
  displayUrl: string;
  safeUrl?: string;
}

export function WebFallbackCard({
  heading,
  description,
  detailReason,
  displayUrl,
  safeUrl,
}: WebFallbackCardProps) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-5 sm:py-6 lg:px-8 xl:px-10">
      <section
        aria-labelledby="web-fallback-heading"
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-6 text-center sm:p-10"
      >
        <div className="mx-auto flex max-w-[56ch] flex-col items-center">
          <Globe
            size={22}
            aria-hidden="true"
            className="text-[var(--color-text-soft)]"
          />
          <h2
            id="web-fallback-heading"
            className="mt-3 text-base font-semibold text-[var(--color-text)]"
          >
            {heading}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
            {description}
          </p>
          {detailReason ? (
            <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-text-soft)]">
              Alasan teknis: {detailReason}
            </p>
          ) : null}

          <p className="mt-3 break-all text-xs text-[var(--color-text-muted)] tabular-nums">
            {displayUrl}
          </p>

          {safeUrl ? (
            <div className="mt-6 flex justify-center">
              <ExternalLinkAction
                url={safeUrl}
                label="Buka situs di tab baru"
                variant="primary"
              />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
