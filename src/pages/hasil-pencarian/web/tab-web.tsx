import { forwardRef, useImperativeHandle } from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { ExternalLinkAction } from '../../../components/external-link-action';
import type { InspectionResult, ResourceRecord } from '../../../types/inspection';
import { getAssetFilename } from '../../../utils/asset-explorer';
import { redactUrlForDisplay } from '../../../utils/redact-url';
import {
  buildXOembedUrl,
  resolveProxyWebViewState,
} from '../../../utils/web-view-policy';
import {
  waitAndCollectFrameResources,
  type CollectFrameOptions,
} from './collect-frame-sources';
import { useWebFrame } from './use-web-frame';
import { WebBypassToast } from './web-bypass-toast';
import { WebDirectAssetView } from './web-direct-asset-view';
import { WebFallbackCard } from './web-fallback-card';

export interface TabWebHandle {
  waitForAndCollectSources: (options?: CollectFrameOptions) => Promise<ResourceRecord[]>;
}

interface TabWebProps {
  inspectionId: string;
  finalUrl: string;
  pageTitle?: string;
  contentType?: string;
  preview: InspectionResult['preview'];
  onAssetObserved?: () => void;
  onDestinationRedirect?: (nextUrl: string) => void;
  fullViewport?: boolean;
}

export const TabWeb = forwardRef<TabWebHandle, TabWebProps>(function TabWeb(
  {
    inspectionId,
    finalUrl,
    pageTitle,
    contentType,
    preview,
    onAssetObserved,
    onDestinationRedirect,
    fullViewport = false,
  },
  ref,
) {
  const preResolved = resolveProxyWebViewState(
    finalUrl,
    preview,
    contentType,
    inspectionId,
  );
  const isHtmlProxy =
    preResolved.status === 'embeddable-proxy' &&
    !preResolved.directAssetKind &&
    Boolean(preResolved.engineUrl);

  const {
    iframeRef,
    renderMode,
    switchRenderMode,
    swStatus,
    swErrorMessage,
    frameHeight,
    frameStatus,
    isSlowLoading,
    engineError,
    engineFallbackNotice,
    dismissEngineFallbackNotice,
    reloadNonce,
    activeTargetUrl,
    bypassExternalLinks,
    bypassNotice,
    dismissBypassNotice,
    handleFrameLoad,
    reloadFrame,
    getObservedEngineResources,
  } = useWebFrame({
    finalUrl,
    initialMode: preResolved.defaultRenderMode,
    isHtmlProxy,
    onAssetObserved,
    onDestinationRedirect,
  });

  const resolved = resolveProxyWebViewState(
    finalUrl,
    preview,
    contentType,
    inspectionId,
    { bypassExternalLinks },
  );

  useImperativeHandle(
    ref,
    () => ({
      waitForAndCollectSources: async (options) => {
        if (renderMode === 'engine') {
          return getObservedEngineResources();
        }
        return waitAndCollectFrameResources(iframeRef.current, activeTargetUrl, {
          ...options,
          mode: 'light',
        });
      },
    }),
    [iframeRef, activeTargetUrl, renderMode, getObservedEngineResources],
  );

  const displayUrl = redactUrlForDisplay(activeTargetUrl);
  const engineFrameHeightClass = fullViewport
    ? 'h-dvh'
    : 'h-[calc(100dvh-8.5rem)] min-h-[540px]';
  const minLightFrameClass = fullViewport ? 'min-h-dvh' : 'min-h-[calc(100dvh-8.5rem)]';
  const isEngineWaitingSw =
    renderMode === 'engine' && (swStatus === 'idle' || swStatus === 'registering');
  const activeEngineError =
    renderMode === 'engine' ? engineError || (swStatus === 'error' ? swErrorMessage : null) : null;
  const shouldShowXNotice =
    resolved.isXDomain && (frameStatus === 'empty' || Boolean(activeEngineError));

  return (
    <div
      id="panel-web"
      role="region"
      aria-label="Pratinjau halaman web"
      className="relative flex w-full flex-col"
    >
      <WebBypassToast host={bypassNotice} onDismiss={dismissBypassNotice} />

      {resolved.status === 'embeddable-proxy' && resolved.proxyUrl && resolved.safeUrl ? (
        resolved.directAssetKind && resolved.directAssetUrl ? (
          <WebDirectAssetView
            kind={resolved.directAssetKind}
            assetUrl={resolved.directAssetUrl}
            originalUrl={resolved.safeUrl}
            title={pageTitle || getAssetFilename(activeTargetUrl)}
            contentType={resolved.contentType ?? undefined}
          />
        ) : (
          <div
            className={`relative flex w-full flex-col bg-white ${
              renderMode === 'engine' ? engineFrameHeightClass : minLightFrameClass
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 sm:px-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <div
                  role="group"
                  aria-label="Mode tampilan web"
                  className="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={renderMode === 'engine'}
                    onClick={() => switchRenderMode('engine')}
                    className={`whitespace-nowrap shrink-0 rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                      renderMode === 'engine'
                        ? 'bg-[var(--color-amber)] text-[var(--color-on-amber)]'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    Mode Engine
                  </button>
                  <button
                    type="button"
                    aria-pressed={renderMode === 'light'}
                    onClick={() => switchRenderMode('light')}
                    className={`whitespace-nowrap shrink-0 rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                      renderMode === 'light'
                        ? 'bg-[var(--color-amber)] text-[var(--color-on-amber)]'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    Mode Ringan
                  </button>
                </div>

                <p className="text-xs text-[var(--color-text-muted)]">
                  Video berlangganan tidak diputar. Situs dengan bot detection bisa menolak. Selain itu biasanya jalan.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={reloadFrame}
                  className="inline-flex min-h-[30px] whitespace-nowrap shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-muted)]"
                >
                  <RotateCw size={13} aria-hidden="true" />
                  Muat ulang
                </button>
                <ExternalLinkAction
                  url={activeTargetUrl || resolved.safeUrl}
                  label="Buka di tab baru"
                  variant="secondary"
                />
              </div>
            </div>

            {engineFallbackNotice ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] sm:px-4">
                <span>{engineFallbackNotice}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => switchRenderMode('engine')}
                    className="whitespace-nowrap shrink-0 font-medium text-[var(--color-text)] underline-offset-2 hover:underline"
                  >
                    Coba Mode Engine lagi
                  </button>
                  <button
                    type="button"
                    onClick={dismissEngineFallbackNotice}
                    className="whitespace-nowrap shrink-0 text-[var(--color-text-soft)] hover:text-[var(--color-text)]"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            ) : null}

            {activeEngineError ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-xs text-[var(--color-text)] sm:px-4">
                <span>Mode Engine gagal memuat halaman: {activeEngineError}</span>
                <button
                  type="button"
                  onClick={() => switchRenderMode('light')}
                  className="whitespace-nowrap shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                >
                  Beralih ke Mode Ringan
                </button>
              </div>
            ) : frameStatus === 'empty' || isSlowLoading ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] sm:px-4">
                <span>
                  {frameStatus === 'empty'
                    ? 'Halaman tampak kosong atau memblokir pemuatan skrip tersemat.'
                    : 'Memuat halaman tujuan lebih lambat dari biasanya...'}
                </span>
                {renderMode === 'light' ? (
                  <button
                    type="button"
                    onClick={() => switchRenderMode('engine')}
                    className="whitespace-nowrap shrink-0 font-medium text-[var(--color-text)] underline-offset-2 hover:underline"
                  >
                    Coba Mode Engine
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => switchRenderMode('light')}
                    className="whitespace-nowrap shrink-0 font-medium text-[var(--color-text)] underline-offset-2 hover:underline"
                  >
                    Coba Mode Ringan
                  </button>
                )}
              </div>
            ) : null}

            {shouldShowXNotice ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)] sm:px-4">
                <span>
                  X.com membatasi sesi tanpa tantangan bot atau memerlukan integrasi resmi (widgets.js / publish.twitter.com/oembed).
                </span>
                <ExternalLinkAction
                  url={buildXOembedUrl(resolved.safeUrl)}
                  label="Buka oEmbed Resmi"
                  variant="secondary"
                />
              </div>
            ) : null}

            {renderMode === 'engine' && resolved.engineUrl ? (
              swStatus === 'ready' ? (
                <iframe
                  ref={iframeRef}
                  key={`engine:${resolved.engineUrl}:${reloadNonce}`}
                  src={resolved.engineUrl}
                  title={`Tampilan web Mode Engine ${pageTitle || resolved.host || 'situs tujuan'}`}
                  allow="clipboard-write; fullscreen; autoplay; encrypted-media"
                  referrerPolicy="no-referrer"
                  loading="eager"
                  onLoad={handleFrameLoad}
                  className="block w-full flex-1 min-h-0 border-0 bg-white"
                />
              ) : (
                <div className="flex flex-1 min-h-0 items-center justify-center bg-white" />
              )
            ) : (
              <iframe
                ref={iframeRef}
                key={`light:${resolved.proxyUrl}:${reloadNonce}`}
                src={resolved.proxyUrl}
                title={`Tampilan web Mode Ringan ${pageTitle || resolved.host || 'situs tujuan'}`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-storage-access-by-user-activation"
                allow="clipboard-write; fullscreen; autoplay"
                referrerPolicy="no-referrer-when-downgrade"
                loading="eager"
                scrolling="auto"
                onLoad={handleFrameLoad}
                style={{ height: `${frameHeight}px` }}
                className={`block w-full bg-white ${minLightFrameClass}`}
              />
            )}

            {frameStatus === 'loading' || isEngineWaitingSw ? (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute inset-x-0 bottom-0 top-[44px] z-10 flex items-center justify-center bg-white/80 backdrop-blur-[1px]"
              >
                <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-xs font-medium text-[var(--color-text)] shadow-sm">
                  <Loader2
                    size={15}
                    className="animate-spin text-[var(--color-amber)]"
                    aria-hidden="true"
                  />
                  <span>
                    {isEngineWaitingSw
                      ? 'Menyiapkan Service Worker Mode Engine...'
                      : renderMode === 'engine'
                        ? 'Memuat halaman melalui Mode Engine...'
                        : 'Memuat pratinjau halaman web...'}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        )
      ) : (
        <WebFallbackCard
          heading={resolved.heading}
          description={resolved.description}
          detailReason={resolved.detailReason}
          displayUrl={displayUrl}
          safeUrl={resolved.safeUrl ?? undefined}
          isXDomain={resolved.isXDomain}
        />
      )}
    </div>
  );
});
