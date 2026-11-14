import { forwardRef, useImperativeHandle } from 'react';
import type { InspectionResult, ResourceRecord } from '../../../types/inspection';
import { getAssetFilename } from '../../../utils/asset-explorer';
import { redactUrlForDisplay } from '../../../utils/redact-url';
import { resolveProxyWebViewState } from '../../../utils/web-view-policy';
import { waitAndCollectFrameResources } from './collect-frame-sources';
import { useWebFrame } from './use-web-frame';
import { WebBypassToast } from './web-bypass-toast';
import { WebDirectAssetView } from './web-direct-asset-view';
import { WebFallbackCard } from './web-fallback-card';

export interface TabWebHandle {
  waitForAndCollectSources: () => Promise<ResourceRecord[]>;
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

  useImperativeHandle(
    ref,
    () => ({
      waitForAndCollectSources: () =>
        waitAndCollectFrameResources(iframeRef.current, activeTargetUrl),
    }),
    [iframeRef, activeTargetUrl],
  );

  const resolved = resolveProxyWebViewState(
    finalUrl,
    preview,
    contentType,
    inspectionId,
    { bypassExternalLinks },
  );
  const displayUrl = redactUrlForDisplay(activeTargetUrl);

  return (
    <div
      id="panel-web"
      role="region"
      aria-label="Pratinjau halaman web"
      className="relative w-full"
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
          <iframe
            ref={iframeRef}
            key={resolved.proxyUrl}
            src={resolved.proxyUrl}
            title={`Tampilan web ${pageTitle || resolved.host || 'situs tujuan'}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-storage-access-by-user-activation"
            allow="clipboard-write; fullscreen; autoplay"
            referrerPolicy="no-referrer-when-downgrade"
            loading="eager"
            scrolling="no"
            onLoad={handleFrameLoad}
            style={{ height: `${frameHeight}px` }}
            className={`block w-full bg-white ${
              fullViewport ? 'min-h-dvh' : 'min-h-[calc(100dvh-8.5rem)]'
            }`}
          />
        )
      ) : (
        <WebFallbackCard
          heading={resolved.heading}
          description={resolved.description}
          detailReason={resolved.detailReason}
          displayUrl={displayUrl}
          safeUrl={resolved.safeUrl ?? undefined}
        />
      )}
    </div>
  );
});
