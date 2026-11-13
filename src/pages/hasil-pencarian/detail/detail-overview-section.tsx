import type { InspectionResult } from '../../../types/inspection';
import { formatTimestampId } from '../../../utils/format-date';
import type { DerivedInspectionDetails } from '../../../utils/inspection-details';
import { getMetaRefreshSummary } from './detail-labels';

interface DetailOverviewSectionProps {
  result: InspectionResult;
  details: DerivedInspectionDetails;
}

export function DetailOverviewSection({
  result,
  details,
}: DetailOverviewSectionProps) {
  return (
    <section
      aria-labelledby="detail-tautan-heading"
      className="space-y-3 border-b border-[var(--color-border)] pb-6"
    >
      <h2
        id="detail-tautan-heading"
        className="text-base font-semibold text-[var(--color-text)]"
      >
        Detail tautan & inspeksi
      </h2>

      {result.page.description ? (
        <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
          {result.page.description}
        </p>
      ) : null}

      <dl className="grid gap-x-6 gap-y-3 pt-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {result.page.title?.trim() ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs font-medium text-[var(--color-text-soft)]">
              Judul halaman
            </dt>
            <dd className="mt-0.5 break-words font-medium text-[var(--color-text)]">
              {result.page.title.trim()}
            </dd>
          </div>
        ) : null}

        <div>
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            Host asal
          </dt>
          <dd className="mt-0.5 break-all font-medium text-[var(--color-text)]">
            {details.originHost}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            Host tujuan akhir
          </dt>
          <dd className="mt-0.5 break-all font-medium text-[var(--color-text)]">
            {details.finalHost}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            Status HTTP & tipe konten
          </dt>
          <dd className="mt-0.5 break-all tabular-nums text-[var(--color-text)]">
            HTTP {result.page.statusCode} · {result.page.contentType}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            URL dikirim
          </dt>
          <dd className="mt-0.5 break-all text-[var(--color-text)] tabular-nums">
            {details.submittedDisplayUrl}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            URL tujuan akhir
          </dt>
          <dd className="mt-0.5 break-all text-[var(--color-text)] tabular-nums">
            {details.finalDisplayUrl}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            Pengalihan & aset ditemukan
          </dt>
          <dd className="mt-0.5 tabular-nums text-[var(--color-text)]">
            {result.summary.redirectCount} langkah · {result.summary.resourceCount} referensi
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            Waktu inspeksi
          </dt>
          <dd className="mt-0.5 tabular-nums text-[var(--color-text)]">
            {formatTimestampId(result.summary.inspectedAt)} ({result.summary.durationMs} ms)
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-[var(--color-text-soft)]">
            Mode proteksi
          </dt>
          <dd className="mt-0.5 text-[var(--color-text)]">
            Inspeksi statis & filter pasif
          </dd>
        </div>

        {details.canonicalDisplayUrl ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs font-medium text-[var(--color-text-soft)]">
              URL kanonik dokumen
            </dt>
            <dd className="mt-0.5 break-all text-[var(--color-text-muted)] tabular-nums">
              {details.canonicalDisplayUrl}
            </dd>
          </div>
        ) : null}

        {result.page.metaRefreshHint ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs font-medium text-[var(--color-amber-strong)]">
              Petunjuk meta refresh (tidak diikuti otomatis)
            </dt>
            <dd className="mt-0.5 break-all text-xs text-[var(--color-text-muted)]">
              {getMetaRefreshSummary(result.page.metaRefreshHint)}
            </dd>
          </div>
        ) : null}
      </dl>

      {result.page.isIdn ? (
        <p className="text-xs leading-relaxed font-medium text-[var(--color-amber-strong)]">
          Domain tujuan memakai karakter internasional (IDN/punycode). Periksa kesesuaian nama host sebelum membuka situs.
        </p>
      ) : null}
    </section>
  );
}
