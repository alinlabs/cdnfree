import { SlidersHorizontal } from 'lucide-react';
import { UrlInput } from '../../components/url-input';
import { formatCleanUrl } from '../../utils/clean-url';
import {
  buildSearchConfigSummary,
  hasCustomSearchConfig,
  parseBulkUrlsInput,
  type SearchConfigState,
} from '../../utils/search-config';
import { parseSingleSearchInput } from '../../utils/smart-url-parser';
import { AnimatedHeroTitle } from './animated-hero-title';

interface HeroSectionProps {
  urlValue: string;
  onUrlChange: (value: string) => void;
  onSubmit: () => void;
  config: SearchConfigState;
  isAutoBulk?: boolean;
  onOpenConfig: () => void;
  onSwitchToBulk?: () => void;
  error?: string | null;
  isLoading?: boolean;
}

export function HeroSection({
  urlValue,
  onUrlChange,
  onSubmit,
  config,
  isAutoBulk = false,
  onOpenConfig,
  onSwitchToBulk,
  error = null,
  isLoading = false,
}: HeroSectionProps) {
  const isBulk = config.linkMode === 'bulk';
  const isCustomConfig = hasCustomSearchConfig(config);
  const bulkCount = isBulk ? parseBulkUrlsInput(urlValue).validUrls.length : 0;
  const singleAnalysis = !isBulk ? parseSingleSearchInput(urlValue) : null;
  const showSingleSmartHint =
    !isBulk &&
    !error &&
    singleAnalysis &&
    singleAnalysis.hadRepairsOrNoise &&
    singleAnalysis.outcome.ok;
  const showAutoBulkBanner = isBulk && isAutoBulk && bulkCount > 0;

  return (
    <section
      aria-labelledby="beranda-heading"
      className="flex flex-col items-center space-y-5 text-center"
    >
      <div className="w-full">
        <AnimatedHeroTitle />
      </div>

      <div className="w-full max-w-[780px] space-y-3 pt-0.5">
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={onOpenConfig}
            aria-label={
              isCustomConfig
                ? 'Konfigurasi pencarian (pengaturan khusus aktif)'
                : 'Konfigurasi pencarian'
            }
            title={
              isCustomConfig
                ? 'Konfigurasi pencarian (aktif)'
                : 'Konfigurasi pencarian'
            }
            className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
            {isCustomConfig ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[var(--color-amber)] ring-2 ring-[var(--color-bg)]"
              />
            ) : null}
          </button>

          <UrlInput
            value={urlValue}
            onChange={onUrlChange}
            onSubmit={onSubmit}
            error={error}
            isLoading={isLoading}
            multiline={isBulk}
            allowAutoMultilinePaste
            label={
              isBulk
                ? 'Daftar URL situs untuk pencarian bulk aset'
                : 'URL situs yang ingin diperiksa'
            }
            placeholder={
              isBulk
                ? 'Tempel beberapa URL sekaligus (dipisah baris baru, spasi, koma, atau menempel langsung)...\ncontoh.com\nsituslain.org/galeri'
                : 'Tempel atau masukkan URL situs...'
            }
            submitLabel={
              isBulk ? 'Mulai cari aset secara serentak' : 'Periksa tautan'
            }
            loadingLabel={
              isBulk ? 'Memeriksa tautan secara serentak...' : 'Memeriksa tautan...'
            }
          />
        </div>

        <div className="space-y-1.5 pt-1 text-center">
          <p className="mx-auto max-w-[60ch] text-base text-[var(--color-text-muted)]">
            Periksa tujuan tautan, redirect, dan aset halaman sebelum Anda membukanya.
          </p>

          {showSingleSmartHint && singleAnalysis.outcome.ok ? (
            <p className="text-xs text-[var(--color-text-soft)]">
              {singleAnalysis.extractedCount > 1 ? (
                <>
                  <span>
                    Terdeteksi{' '}
                    <strong className="font-medium tabular-nums text-[var(--color-text-muted)]">
                      {singleAnalysis.extractedCount} tautan
                    </strong>{' '}
                    (memeriksa {formatCleanUrl(singleAnalysis.outcome.normalizedUrl)})
                  </span>
                  {onSwitchToBulk ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      <button
                        type="button"
                        onClick={onSwitchToBulk}
                        className="font-medium text-[var(--color-amber-strong)] underline-offset-2 hover:underline"
                      >
                        Cari semua di mode Bulk
                      </button>
                    </>
                  ) : null}
                </>
              ) : (
                <span>
                  Tautan terdeteksi:{' '}
                  <span className="font-medium text-[var(--color-text-muted)]">
                    {formatCleanUrl(singleAnalysis.outcome.normalizedUrl)}
                  </span>
                </span>
              )}
            </p>
          ) : null}

          {showAutoBulkBanner ? (
            <p className="text-xs text-[var(--color-text-soft)]">
              <span>
                Terdeteksi{' '}
                <strong className="font-medium tabular-nums text-[var(--color-text-muted)]">
                  {bulkCount} tautan
                </strong>
              </span>
              <span aria-hidden="true"> · </span>
              <span>
                Mode otomatis beralih ke{' '}
                <strong className="font-medium text-[var(--color-text-muted)]">
                  {buildSearchConfigSummary(config)}
                </strong>
              </span>
              <span aria-hidden="true"> · </span>
              <button
                type="button"
                onClick={onOpenConfig}
                className="font-medium text-[var(--color-amber-strong)] underline-offset-2 hover:underline"
              >
                Ubah
              </button>
            </p>
          ) : isCustomConfig ? (
            <p className="text-xs text-[var(--color-text-soft)]">
              <span>Mode: {buildSearchConfigSummary(config)}</span>
              {isBulk && bulkCount > 0 ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="tabular-nums font-medium text-[var(--color-text-muted)]">
                    {bulkCount} URL terdeteksi
                  </span>
                </>
              ) : null}
              <span aria-hidden="true"> · </span>
              <button
                type="button"
                onClick={onOpenConfig}
                className="font-medium text-[var(--color-amber-strong)] underline-offset-2 hover:underline"
              >
                Ubah
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
