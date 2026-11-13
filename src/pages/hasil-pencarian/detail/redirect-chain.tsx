import type { RedirectHopRecord } from '../../../types/inspection';
import { getHostnameSafe } from '../../../utils/inspection-details';
import { redactUrlForDisplay } from '../../../utils/redact-url';

interface RedirectChainProps {
  redirects: RedirectHopRecord[];
  finalUrl: string;
  finalStatusCode: number;
}

export function RedirectChain({
  redirects,
  finalUrl,
  finalStatusCode,
}: RedirectChainProps) {
  const finalHost = getHostnameSafe(finalUrl);

  return (
    <section
      aria-labelledby="rantai-pengalihan-heading"
      className="space-y-3 border-b border-[var(--color-border)] pb-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="rantai-pengalihan-heading"
          className="text-base font-semibold text-[var(--color-text)]"
        >
          Rantai pengalihan
        </h2>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {redirects.length} pengalihan
        </span>
      </div>

      {redirects.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Tidak ada pengalihan HTTP yang tercatat sebelum mencapai halaman tujuan ({finalHost}).
        </p>
      ) : (
        <ol className="space-y-2.5 text-sm">
          {redirects.map((hop, index) => {
            const nextHost =
              index + 1 < redirects.length ? redirects[index + 1].host : finalHost;
            const hostChanged = nextHost !== hop.host;

            return (
              <li
                key={`${hop.step}-${hop.url}`}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[var(--color-text)]">
                    Langkah {hop.step} · {hop.host}
                    {hostChanged ? (
                      <span className="font-normal text-[var(--color-text-muted)]">
                        {' '}→ {nextHost}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-xs font-medium text-[var(--color-text-muted)]">
                    HTTP {hop.statusCode}
                  </span>
                </div>

                <p className="mt-1 break-all text-xs text-[var(--color-text-muted)] tabular-nums">
                  {redactUrlForDisplay(hop.url)}
                </p>

                {hop.reason ? (
                  <p className="mt-1.5 text-xs font-medium text-[var(--color-danger)]">
                    Perlu ditinjau: {hop.reason}
                  </p>
                ) : null}
              </li>
            );
          })}

          <li className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-[var(--color-text)]">
                Tujuan akhir · {finalHost}
              </span>
              <span className="tabular-nums text-xs font-medium text-[var(--color-success)]">
                HTTP {finalStatusCode}
              </span>
            </div>
            <p className="mt-1 break-all text-xs text-[var(--color-text-muted)] tabular-nums">
              {redactUrlForDisplay(finalUrl)}
            </p>
          </li>
        </ol>
      )}
    </section>
  );
}
