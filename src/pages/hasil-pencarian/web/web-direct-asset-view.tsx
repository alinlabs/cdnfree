import { useEffect, useState } from 'react';
import { PdfViewerSurface } from '../../../components/pdf-preview';
import {
  FontPreviewSurface,
  TextPreviewSurface,
} from '../../../components/text-asset-modal';
import type { InlineAssetPreviewKind } from '../../../utils/asset-explorer';
import {
  getVideoErrorCopy,
  mapVideoMediaError,
  type VideoPlaybackFailureKind,
} from '../media-player/media-player-utils';

interface WebDirectAssetViewProps {
  kind: Exclude<InlineAssetPreviewKind, 'none'>;
  assetUrl: string;
  originalUrl?: string;
  title: string;
  contentType?: string;
}

export function WebDirectAssetView({
  kind,
  assetUrl,
  originalUrl,
  title,
  contentType,
}: WebDirectAssetViewProps) {
  const [videoFailure, setVideoFailure] = useState<VideoPlaybackFailureKind | null>(null);
  const [useDirectVideo, setUseDirectVideo] = useState(false);
  const [durationHint, setDurationHint] = useState<string | null>(null);

  useEffect(() => {
    setVideoFailure(null);
    setUseDirectVideo(false);
    setDurationHint(null);
  }, [assetUrl]);

  const activeVideoSrc = useDirectVideo && originalUrl ? originalUrl : assetUrl;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-5 sm:py-6 lg:px-8 xl:px-10">
      {kind === 'image' ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-checker-bg)] bg-[radial-gradient(var(--color-checker-dot)_1px,transparent_1px)] [background-size:12px_12px] p-4">
          <img
            key={assetUrl}
            src={assetUrl}
            alt={title}
            className="max-w-full object-contain"
          />
        </div>
      ) : kind === 'pdf' ? (
        <PdfViewerSurface key={assetUrl} src={assetUrl} title={title} />
      ) : kind === 'video' ? (
        videoFailure ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {getVideoErrorCopy(videoFailure, contentType, useDirectVideo).title}
            </p>
            <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-[var(--color-text-muted)]">
              {getVideoErrorCopy(videoFailure, contentType, useDirectVideo).description}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {!useDirectVideo && originalUrl && (videoFailure === 'src' || videoFailure === 'network' || videoFailure === 'unknown') ? (
                <button
                  type="button"
                  onClick={() => {
                    setVideoFailure(null);
                    setUseDirectVideo(true);
                  }}
                  className="inline-flex min-h-[38px] items-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-1.5 text-xs font-semibold text-[var(--color-on-amber)] hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
                >
                  Putar langsung
                </button>
              ) : null}
              {originalUrl ? (
                <a
                  href={originalUrl}
                  download={title}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[38px] items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]"
                >
                  Unduh
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <video
              key={activeVideoSrc}
              src={activeVideoSrc}
              controls
              preload="metadata"
              playsInline
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (!Number.isFinite(v.duration)) {
                  setDurationHint('Durasi belum terbaca — coba geser atau putar langsung.');
                } else {
                  setDurationHint(null);
                }
              }}
              onError={(e) => {
                setVideoFailure(mapVideoMediaError(e.currentTarget.error?.code));
              }}
              className="block w-full rounded-[var(--radius-sm)] bg-[#1C1C1C]"
            >
              <source src={activeVideoSrc} type={contentType || undefined} />
            </video>
            {durationHint ? (
              <p className="text-xs text-[var(--color-text-muted)]">{durationHint}</p>
            ) : null}
          </div>
        )
      ) : kind === 'audio' ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-6">
          <audio key={assetUrl} src={assetUrl} controls className="w-full" />
        </div>
      ) : kind === 'font' ? (
        <FontPreviewSurface key={assetUrl} src={assetUrl} title={title} />
      ) : (
        <TextPreviewSurface
          key={assetUrl}
          src={assetUrl}
          mimeType={contentType}
        />
      )}
    </div>
  );
}
