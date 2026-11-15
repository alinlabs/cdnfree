import type { InspectionResult } from '../../../types/inspection';

interface BlockingSummarySectionProps {
  summary: InspectionResult['summary'];
  flaggedResourceCount: number;
}

export function BlockingSummarySection({
  summary,
  flaggedResourceCount,
}: BlockingSummarySectionProps) {
  return (
    <section
      aria-labelledby="pemblokiran-heading"
      className="space-y-3 border-b border-[var(--color-border)] pb-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="pemblokiran-heading"
          className="text-base font-semibold text-[var(--color-text)]"
        >
          Pemblokiran
        </h2>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {summary.blockedCount} diblokir
        </span>
      </div>

      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            Diblokir runtime
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text)]">
            {summary.blockedCount}
          </dd>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            Ditandai filter / heuristik
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text)]">
            {summary.flaggedCount}
          </dd>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            Skema tidak aman ditolak
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text)]">
            {summary.unsafeSchemeCount}
          </dd>
        </div>
      </dl>

      {flaggedResourceCount > 0 ? (
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          {flaggedResourceCount} referensi aset cocok dengan daftar filter jaringan pasif dan ditandai untuk ditinjau; kecocokan daftar filter bukan pemblokiran runtime.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          Angka pemblokiran runtime bernilai 0 karena inspeksi statis hanya menginventarisasi dan menandai referensi tanpa menjalankan halaman.
        </p>
      )}
    </section>
  );
}
