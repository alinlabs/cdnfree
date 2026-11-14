import { useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../../../components/empty-state';
import { ErrorState } from '../../../components/error-state';
import { Footer } from '../../../components/footer';
import { LoadingState } from '../../../components/loading-state';
import { PageContainer } from '../../../components/page-container';
import { TopProgressLine } from '../../../components/top-progress-line';
import { NotFoundPage } from '../../not-found';
import { TabAset } from '../aset/tab-aset';
import { useAssetManager } from '../aset/use-asset-manager';
import { TabDetail } from '../detail/tab-detail';
import { FloatingBrandMenu } from '../web/floating-brand-menu';
import { TabWeb } from '../web/tab-web';
import { ResultsHeader, type AssetHeaderControls } from './results-header';
import { buildResultsRoutePath } from './results-navigation';
import { useBulkWorkspace } from './use-bulk-workspace';
import { useInspectionWorkspace } from './use-inspection-workspace';

export function HasilPencarianPage() {
  const navigate = useNavigate();
  const {
    resolvedTab,
    activeTab,
    canReturnToWeb,
    selectTab,
    bulkId,
    submittedUrl,
    loading,
    isReinspecting,
    isPreparingAssets,
    error,
    result,
    liveResult,
    deduplicatedResources,
    hideWebChrome,
    setHideWebChrome,
    quickUrl,
    quickUrlError,
    setQuickUrlValue,
    tabWebRef,
    scheduleCaptureRefresh,
    collectAllLiveAssets,
    handleReinspect,
    handleOpenAssetManager,
    handleDestinationRedirect,
    handleQuickSubmit,
  } = useInspectionWorkspace();

  const bulk = useBulkWorkspace(bulkId);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bulkId && activeTab !== 'aset') {
      navigate(buildResultsRoutePath('aset', { bulkId }), { replace: true });
    }
  }, [bulkId, activeTab, navigate]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [activeTab, result?.id, bulkId]);

  const effectiveScopeId = bulk.isBulkMode
    ? `bulk:${bulkId}`
    : (result?.id ?? null);
  const effectiveResources = bulk.isBulkMode
    ? bulk.mergedResources
    : deduplicatedResources;

  const assetManager = useAssetManager(effectiveScopeId, effectiveResources, {
    activeTab,
    targetUrl: bulk.isBulkMode
      ? null
      : (result?.finalUrl ?? result?.submittedUrl ?? submittedUrl),
    bulkId: bulk.isBulkMode ? bulkId : null,
    resolveInspectionId: bulk.isBulkMode ? bulk.resolveInspectionId : undefined,
  });

  const assetControls: AssetHeaderControls | undefined = useMemo(
    () =>
      result || bulk.session
        ? {
            query: assetManager.query,
            onQueryChange: assetManager.setQuery,
            kindFilter: assetManager.kindFilter,
            onKindFilterChange: assetManager.setKindFilter,
            formatFilters: assetManager.formatFilters,
            onFormatFiltersChange: assetManager.setFormatFilters,
            statusFilter: assetManager.statusFilter,
            onStatusFilterChange: assetManager.setStatusFilter,
            filteredCount: assetManager.filteredResources.length,
            totalCount: effectiveResources.length,
            downloadableCount: assetManager.downloadableCount,
            batchDownloading: assetManager.batchDownloading,
            onDownloadAll: () => {
              void assetManager.handleDownloadAll();
            },
            onCancelDownloadAll: assetManager.handleCancelDownloadAll,
            onRefreshAssets: () => {
              if (bulk.isBulkMode) {
                bulk.refreshBulk();
              } else if (result) {
                void collectAllLiveAssets(result.id);
              }
            },
          }
        : undefined,
    [result, bulk, assetManager, effectiveResources.length, collectAllLiveAssets],
  );

  if (resolvedTab === null) {
    return <NotFoundPage />;
  }

  const isImmersiveWeb =
    !bulk.isBulkMode &&
    activeTab === 'web' &&
    Boolean(liveResult) &&
    !loading &&
    !error &&
    hideWebChrome;

  const bulkSubtitle = bulk.isBulkMode
    ? `${bulk.finishedCount}/${bulk.totalSiteCount} situs selesai · ${bulk.allSiteTotalAssetCount} aset`
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {!isImmersiveWeb ? (
        <ResultsHeader
          result={!loading && !error && !bulk.isBulkMode ? result : null}
          loading={loading || isReinspecting}
          error={error}
          quickUrl={quickUrl}
          quickUrlError={quickUrlError}
          onQuickUrlChange={setQuickUrlValue}
          onQuickSubmit={handleQuickSubmit}
          isReinspecting={isReinspecting}
          onReinspect={handleReinspect}
          activeTab={activeTab}
          onSelectTab={(tab) => selectTab(tab)}
          resourceCount={effectiveResources.length}
          assetControls={assetControls}
          onHideFrame={() => setHideWebChrome(true)}
          onOpenAssets={() => {
            void handleOpenAssetManager();
          }}
          isPreparingAssets={isPreparingAssets}
          isBusy={loading || isReinspecting || isPreparingAssets || bulk.isRunning}
          progressLabel={
            bulk.isRunning
              ? `Memeriksa ${bulk.finishedCount}/${bulk.totalSiteCount} tautan secara paralel...`
              : isPreparingAssets
                ? 'Mempersiapkan aset halaman...'
                : isReinspecting
                  ? 'Memuat ulang halaman...'
                  : 'Memeriksa tautan...'
          }
          isBulkMode={bulk.isBulkMode}
          canReturnToWeb={canReturnToWeb}
          bulkSubtitle={bulkSubtitle}
          onGoHome={() => navigate('/')}
        />
      ) : null}

      <div
        ref={scrollContainerRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {bulk.isBulkMissing ? (
          <PageContainer className="flex-1 py-5 sm:py-6">
            <EmptyState
              title="Sesi bulk link tidak ditemukan"
              description="Sesi pencarian aset massal ini sudah kedaluwarsa atau berasal dari tab browser lain. Mulai pencarian baru dari halaman Beranda."
              action={
                <Link
                  to="/"
                  className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
                >
                  Kembali ke Beranda
                </Link>
              }
            />
          </PageContainer>
        ) : bulk.isBulkMode && bulk.session ? (
          <PageContainer className="flex-1 py-5 sm:py-6">
            <TabAset
              key={`bulk:${bulk.session.id}`}
              inspectionId={`bulk:${bulk.session.id}`}
              totalCount={effectiveResources.length}
              filteredResources={assetManager.filteredResources}
              kindFilter={assetManager.kindFilter}
              hasFormatFilter={assetManager.formatFilters.length > 0}
              batchStatus={assetManager.batchStatus}
              fullView={assetManager.fullView}
              resolveInspectionId={bulk.resolveInspectionId}
              isBulkLoading={bulk.isRunning}
              onOpenFullView={assetManager.openFullView}
              onChangeFullViewItem={assetManager.changeFullViewItem}
              onCloseFullView={assetManager.closeFullView}
              onResetFilters={() => {
                bulk.setSiteFilter('all');
                assetManager.resetFilters();
              }}
            />
          </PageContainer>
        ) : loading || (isReinspecting && !result) ? (
          <PageContainer className="flex-1 py-5 sm:py-6">
            <LoadingState label="Memeriksa tautan dan mengekstrak struktur halaman..." rows={5} />
          </PageContainer>
        ) : error ? (
          <PageContainer className="flex-1 py-5 sm:py-6">
            <ErrorState
              title="Tidak dapat memeriksa situs ini."
              description={error}
              action={
                <div className="flex flex-wrap gap-3">
                  {submittedUrl ? (
                    <button
                      type="button"
                      disabled={isReinspecting}
                      onClick={handleReinspect}
                      className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Coba lagi
                    </button>
                  ) : null}
                  <Link
                    to="/"
                    className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
                  >
                    Kembali ke Beranda
                  </Link>
                </div>
              }
            />
          </PageContainer>
        ) : !result ? (
          <PageContainer className="flex-1 py-5 sm:py-6">
            <EmptyState
              title="Belum ada hasil inspeksi aktif"
              description="Masukkan URL pada kotak di atas atau mulai dari halaman Beranda untuk memeriksa tujuan akhir, rantai pengalihan, dan aset halaman."
              action={
                <Link
                  to="/"
                  className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
                >
                  Periksa tautan di Beranda
                </Link>
              }
            />
          </PageContainer>
        ) : liveResult ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              className={activeTab === 'web' ? 'w-full flex-1' : 'hidden'}
              aria-hidden={activeTab !== 'web'}
            >
              <TabWeb
                ref={tabWebRef}
                key={liveResult.id}
                inspectionId={liveResult.id}
                finalUrl={liveResult.finalUrl}
                pageTitle={liveResult.page.title}
                contentType={liveResult.page.contentType}
                preview={liveResult.preview}
                fullViewport={isImmersiveWeb}
                onAssetObserved={() => scheduleCaptureRefresh(liveResult.id)}
                onDestinationRedirect={handleDestinationRedirect}
              />
            </div>

            {activeTab === 'detail' ? (
              <PageContainer className="flex-1 py-5 sm:py-6">
                <TabDetail key={liveResult.id} result={liveResult} />
              </PageContainer>
            ) : activeTab === 'aset' ? (
              <PageContainer className="flex-1 py-5 sm:py-6">
                <TabAset
                  key={liveResult.id}
                  inspectionId={liveResult.id}
                  sourcePageUrl={liveResult.finalUrl}
                  totalCount={deduplicatedResources.length}
                  filteredResources={assetManager.filteredResources}
                  kindFilter={assetManager.kindFilter}
                  hasFormatFilter={assetManager.formatFilters.length > 0}
                  batchStatus={assetManager.batchStatus}
                  fullView={assetManager.fullView}
                  onOpenFullView={assetManager.openFullView}
                  onChangeFullViewItem={assetManager.changeFullViewItem}
                  onCloseFullView={assetManager.closeFullView}
                  onResetFilters={assetManager.resetFilters}
                />
              </PageContainer>
            ) : null}
          </div>
        ) : null}

        {!isImmersiveWeb ? <Footer compactBottomPadding /> : null}
      </div>

      {isImmersiveWeb ? (
        <FloatingBrandMenu
          onShowBar={() => setHideWebChrome(false)}
          onRefreshPage={() => {
            void handleReinspect();
          }}
          onSelectTab={(tab) => selectTab(tab)}
          onOpenAssets={() => {
            void handleOpenAssetManager();
          }}
          onGoHome={() => navigate('/')}
          resourceCount={deduplicatedResources.length}
          isReinspecting={isReinspecting}
          isPreparingAssets={isPreparingAssets}
        />
      ) : null}

      <TopProgressLine
        visible={isImmersiveWeb && (isPreparingAssets || isReinspecting)}
        placement="viewport-top"
        label={
          isPreparingAssets
            ? 'Mempersiapkan aset halaman...'
            : 'Memuat ulang halaman...'
        }
      />
    </div>
  );
}
