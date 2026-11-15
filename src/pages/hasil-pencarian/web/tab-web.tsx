import { forwardRef, useImperativeHandle } from 'react';
import { Loader2 } from 'lucide-react';
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
  const {
    iframeRef,
    frameHeight,
    frameStatus,
    activeTargetUrl,
    bypassExternalLinks,
    bypassNotice,
    dismissBypassNotice,
    handleFrameLoad,
  } = useWebFrame({
    finalUrl,
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
      waitForAndCollectSources: async (options) =>
        waitAndCollectFrameResources(iframeRef.current, activeTargetUrl, {
          ...options,
          mode: 'light',
        }),
    }),
    [iframeRef, activeTargetUrl],
  );

  const displayUrl = redactUrlForDisplay(activeTargetUrl);
  const minLightFrameClass = fullViewport ? 'min-h-dvh' : 'min-h-[calc(100dvh-8.5rem)]';
  const shouldShowXNotice = resolved.isXDomain && frameStatus === 'empty';

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
          <div className={`relative flex w-full flex-col bg-white ${minLightFrameClass}`}>
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

            <iframe
              ref={iframeRef}
              key={`light:${resolved.proxyUrl}`}
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

            {frameStatus === 'loading' ? (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-[1px]"
              >
                <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-xs font-medium text-[var(--color-text)] shadow-sm">
                  <Loader2
                    size={15}
                    className="animate-spin text-[var(--color-amber)]"
                    aria-hidden="true"
                  />
                  <span>Memuat pratinjau halaman web...</span>
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
