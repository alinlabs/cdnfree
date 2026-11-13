import { useEffect, useId, useState } from 'react';
import { ChevronLeft, Database, Info, Loader2 } from 'lucide-react';
import { BrandWordmark } from '../../../components/brand-wordmark';
import { PageContainer } from '../../../components/page-container';
import { TopProgressLine } from '../../../components/top-progress-line';
import type { InspectionResult } from '../../../types/inspection';
import { getHostnameSafe } from '../../../utils/inspection-details';
import { formatCleanUrl } from '../../../utils/clean-url';
import { WebFrameMenu } from '../web/web-frame-menu';
import {
  ResultsHeaderAssetSearch,
  ResultsHeaderAssetToolbar,
  type AssetHeaderControls,
} from './results-header-asset-bar';
import { ResultsHeaderWebBar } from './results-header-web-bar';
import {
  shouldShowWebBackButton,
  type ResultsTabKey,
} from './results-navigation';

export type { AssetHeaderControls };

interface ResultsHeaderProps {
  result: InspectionResult | null;
  loading: boolean;
  error: string | null;
  quickUrl: string;
  quickUrlError: string | null;
  onQuickUrlChange: (value: string) => void;
  onQuickSubmit: () => void;
  isReinspecting: boolean;
  onReinspect: () => void;
  activeTab: ResultsTabKey;
  onSelectTab: (tab: ResultsTabKey) => void;
  resourceCount: number;
  assetControls?: AssetHeaderControls;
  onHideFrame?: () => void;
  onOpenAssets?: () => void;
  isPreparingAssets?: boolean;
  isBusy?: boolean;
  progressLabel?: string;
  isBulkMode?: boolean;
  canReturnToWeb?: boolean;
  bulkSubtitle?: string;
  onGoHome?: () => void;
}

export function ResultsHeader({
  result,
  loading,
  error,
  quickUrl,
  quickUrlError,
  onQuickUrlChange,
  onQuickSubmit,
  isReinspecting,
  onReinspect,
  activeTab,
  onSelectTab,
  resourceCount,
  assetControls,
  onHideFrame,
  onOpenAssets,
  isPreparingAssets = false,
  isBusy = false,
  progressLabel,
  isBulkMode = false,
  canReturnToWeb = false,
  bulkSubtitle,
  onGoHome,
}: ResultsHeaderProps) {
  const errorId = useId();
  const [assetSearchOpen, setAssetSearchOpen] = useState(
    () => Boolean(activeTab === 'aset' && assetControls?.query.trim()),
  );

  useEffect(() => {
    if (activeTab !== 'aset' || !assetControls?.query.trim()) {
      setAssetSearchOpen(false);
    }
  }, [result?.id, isBulkMode]);

  useEffect(() => {
    if (activeTab !== 'aset') {
      setAssetSearchOpen(false);
    } else if (assetControls?.query.trim()) {
      setAssetSearchOpen(true);
    }
  }, [activeTab, assetControls?.query]);

  const finalHost = result ? getHostnameSafe(result.finalUrl) : undefined;
  const headingText = isBulkMode
    ? 'Bulk Aset Manager'
    : result
      ? result.page.title?.trim() || finalHost || 'Hasil inspeksi'
      : loading
        ? 'Memeriksa tautan...'
        : error
          ? 'Gagal memeriksa tautan'
          : 'Hasil inspeksi';

  const showAssetControls = Boolean(
    activeTab === 'aset' && (result || isBulkMode) && assetControls,
  );
  const showBackToWeb = shouldShowWebBackButton({
    activeTab,
    isBulkMode,
    canReturnToWeb,
  });

  const handleSecondaryTitleClick = () => {
    if (showBackToWeb) {
      onSelectTab('web');
    } else if (onGoHome) {
      onGoHome();
    }
  };

  return (
    <header className="relative z-30 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      <PageContainer className="py-2.5 sm:py-3">
        <h1 className="sr-only">{headingText}</h1>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex shrink-0 items-center gap-1">
            {showBackToWeb ? (
              <button
                type="button"
                onClick={() => onSelectTab('web')}
                aria-label="Kembali ke tampilan Web"
                title="Kembali ke tampilan Web"
                className="inline-flex h-8 w-6 -ml-1 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:text-[var(--color-text)]"
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            ) : null}

            <div className={showBackToWeb ? 'hidden sm:flex' : 'flex'}>
              <BrandWordmark size="md" />
            </div>
          </div>

          {activeTab === 'web' ? (
            <ResultsHeaderWebBar
              result={result}
              loading={loading}
              isReinspecting={isReinspecting}
              quickUrl={quickUrl}
              quickUrlError={quickUrlError}
              errorId={errorId}
              onQuickUrlChange={onQuickUrlChange}
              onQuickSubmit={onQuickSubmit}
              onReinspect={onReinspect}
            />
          ) : showAssetControls && assetControls && assetSearchOpen ? (
            <ResultsHeaderAssetSearch
              assetControls={assetControls}
              onCloseSearch={() => setAssetSearchOpen(false)}
            />
          ) : (
            <button
              type="button"
              onClick={handleSecondaryTitleClick}
              aria-label={
                showBackToWeb ? 'Kembali ke tampilan Web' : 'Kembali ke Beranda'
              }
              title={
                showBackToWeb ? 'Kembali ke tampilan Web' : 'Kembali ke Beranda'
              }
              className={`group flex min-h-9 min-w-0 flex-1 flex-col justify-center text-left transition-colors duration-150 ${
                showBackToWeb
                  ? 'pl-1 sm:border-l sm:border-[var(--color-border)] sm:pl-3'
                  : 'border-l border-[var(--color-border)] pl-2.5 sm:pl-3'
              }`}
            >
              <span className="block truncate text-sm font-semibold leading-tight text-[var(--color-text)] transition-colors duration-150 group-hover:text-[var(--color-amber-strong)]">
                {activeTab === 'detail'
                  ? 'Detail & Inspeksi'
                  : isBulkMode
                    ? 'Bulk Aset Manager'
                    : 'Aset Manager'}
              </span>
              <span className="block truncate text-xs leading-tight text-[var(--color-text-soft)] tabular-nums">
                {isBulkMode
                  ? bulkSubtitle || 'Pencarian aset paralel'
                  : result
                    ? formatCleanUrl(result.finalUrl, { redactSensitive: true })
                    : quickUrl}
              </span>
            </button>
          )}

          {activeTab === 'web' ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                id="tab-detail-trigger"
                type="button"
                disabled={!result}
                onClick={() => onSelectTab('detail')}
                aria-label="Detail"
                title="Detail"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Info size={18} aria-hidden="true" />
              </button>

              <button
                id="tab-aset-trigger"
                type="button"
                disabled={!result || isPreparingAssets}
                onClick={() => {
                  if (onOpenAssets) {
                    onOpenAssets();
                  } else {
                    onSelectTab('aset');
                  }
                }}
                aria-busy={isPreparingAssets}
                aria-label={`Aset (${resourceCount})`}
                title={`Aset (${resourceCount})`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPreparingAssets ? (
                  <Loader2 size={18} aria-hidden="true" className="animate-spin text-[var(--color-amber)]" />
                ) : (
                  <Database size={18} aria-hidden="true" />
                )}
              </button>

              {onHideFrame ? (
                <WebFrameMenu disabled={!result} onHideFrame={onHideFrame} />
              ) : null}
            </div>
          ) : showAssetControls && assetControls ? (
            <ResultsHeaderAssetToolbar
              assetControls={assetControls}
              assetSearchOpen={assetSearchOpen}
              onOpenSearch={() => setAssetSearchOpen(true)}
            />
          ) : null}
        </div>

        {quickUrlError ? (
          <p
            id={errorId}
            role="alert"
            className="mt-2 text-xs font-medium text-[var(--color-danger)]"
          >
            {quickUrlError}
          </p>
        ) : null}

        {result?.page.isIdn ? (
          <p className="mt-2 text-xs font-medium text-[var(--color-amber-strong)]">
            Catatan domain: alamat tujuan memakai karakter internasional (IDN/punycode). Pastikan nama host sesuai sebelum membuka situs.
          </p>
        ) : null}
      </PageContainer>

      <TopProgressLine
        visible={isBusy}
        placement="header-bottom"
        label={progressLabel}
      />
    </header>
  );
}
