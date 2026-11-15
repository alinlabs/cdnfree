import { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { ExternalLinkAction } from '../../../components/external-link-action';
import { useInView } from '../../../hooks/use-in-view';
import type { ResourceRecord } from '../../../types/inspection';
import {
  evaluateAudioPreview,
  getAssetFilename,
  isAssetOverInlineLimit,
  isUnverifiedAsset,
} from '../../../utils/asset-explorer';
import { formatBytes } from '../../../utils/format-bytes';
import { resolveCopyableMediaUrl } from '../../../utils/local-media';
import { resolveInlineStreamUrl } from '../../../utils/proxy-url';
import { redactUrlForDisplay } from '../../../utils/redact-url';
import { getAssetDownloadEligibility } from '../../../utils/safe-external-url';
import { useCopyFeedback } from '../shared/use-copy-feedback';
import { useResourceDownloads } from '../shared/use-resource-downloads';
import { AssetCardActions, AssetDownloadStatus } from './asset-card-actions';

interface AudioGalleryProps {
  inspectionId: string;
  audios: ResourceRecord[];
  resolveInspectionId?: (resource: ResourceRecord) => string;
}

const INITIAL_AUDIO_BATCH = 12;

function AudioCard({
  resource,
  targetSid,
  dlState,
  copied,
  onDownload,
  onCopy,
}: {
  resource: ResourceRecord;
  targetSid: string;
  dlState: ReturnType<ReturnType<typeof useResourceDownloads>['getDownloadState']>;
  copied: boolean;
  onDownload: () => void;
  onCopy: () => void;
}) {
  const { ref, inView } = useInView();
  const [useStreamFallback, setUseStreamFallback] = useState(false);
  const [failedBoth, setFailedBoth] = useState(false);

  const filename = getAssetFilename(resource.url);
  const preview = evaluateAudioPreview(resource);
  const overLimit = isAssetOverInlineLimit(resource);
  const unverified = isUnverifiedAsset(resource);
  const eligibility = getAssetDownloadEligibility(resource);
  const isFlagged =
    resource.classification !== 'allowed' &&
    resource.classification !== 'unknown';

  const streamSrc = resolveInlineStreamUrl(resource, targetSid);
  const activeSrc = useStreamFallback ? streamSrc : resource.url;

  return (
    <li
      ref={ref}
      className="flex min-w-0 flex-col justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5"
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Volume2
              size={15}
              aria-hidden="true"
              className="shrink-0 text-[var(--color-text-soft)]"
            />
            <p
              className="truncate text-sm font-medium text-[var(--color-text)]"
              title={filename}
            >
              {filename}
            </p>
          </div>
          {unverified ? (
            <span className="shrink-0 text-[11px] font-medium text-[var(--color-amber-strong)]">
              belum terverifikasi
            </span>
          ) : null}
        </div>

        <p className="line-clamp-1 break-all text-xs text-[var(--color-text-muted)] tabular-nums">
          {redactUrlForDisplay(resource.url)}
        </p>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-soft)] tabular-nums">
          <span>{resource.host}</span>
          {resource.mimeType ? <span>{resource.mimeType}</span> : null}
          <span>{formatBytes(resource.declaredBytes)}</span>
        </div>

        {overLimit ? (
          <div className="pt-1">
            <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">
              Ukuran melebihi batas pratinjau inline 40 MiB.
            </p>
            <ExternalLinkAction
              direct
              url={resource.url}
              label="Buka di tab baru"
              variant="secondary"
            />
          </div>
        ) : !preview.canRenderAudio ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            {preview.note}
          </p>
        ) : failedBoth ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Gagal memuat audio inline. Gunakan tautan sumber atau unduh berkas.
          </p>
        ) : inView ? (
          <audio
            key={activeSrc}
            controls
            preload="none"
            src={activeSrc}
            aria-label={`Pemutar audio ${filename}`}
            onError={() => {
              if (!useStreamFallback) {
                setUseStreamFallback(true);
              } else {
                setFailedBoth(true);
              }
            }}
            className="mt-1.5 h-9 w-full"
          />
        ) : null}

        <AssetDownloadStatus state={dlState} />
      </div>

      <AssetCardActions
        eligibleForDownload={eligibility.eligible}
        isDownloading={dlState.status === 'downloading'}
        isCopied={copied}
        onDownload={onDownload}
        onCopy={onCopy}
        externalUrl={resource.url}
        externalWarningText={
          isFlagged
            ? resource.reason || 'Aset ditandai oleh aturan filter.'
            : undefined
        }
      />
    </li>
  );
}

export function AudioGallery({
  inspectionId,
  audios,
  resolveInspectionId,
}: AudioGalleryProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_AUDIO_BATCH);
  const { isCopied, copyText } = useCopyFeedback();
  const { getDownloadState, downloadResource } = useResourceDownloads(
    inspectionId,
    resolveInspectionId,
  );

  if (audios.length === 0) return null;

  const visibleAudios = audios.slice(0, visibleCount);
  const remaining = audios.length - visibleAudios.length;

  return (
    <section aria-labelledby="galeri-audio-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="galeri-audio-heading"
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          Galeri audio
        </h3>
        <span className="tabular-nums text-xs text-[var(--color-text-soft)]">
          {audios.length} audio
        </span>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleAudios.map((resource) => {
          const filename = getAssetFilename(resource.url);
          const targetSid = resolveInspectionId?.(resource) ?? inspectionId;
          return (
            <AudioCard
              key={resource.id}
              resource={resource}
              targetSid={targetSid}
              dlState={getDownloadState(resource.id)}
              copied={isCopied(resource.id)}
              onDownload={() => {
                void downloadResource(resource, filename);
              }}
              onCopy={() => {
                void copyText(resolveCopyableMediaUrl(resource.url), resource.id);
              }}
            />
          );
        })}
      </ul>

      {remaining > 0 ? (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => prev + INITIAL_AUDIO_BATCH)}
            className="min-h-[38px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            Tampilkan audio lainnya ({remaining} tersisa)
          </button>
        </div>
      ) : null}
    </section>
  );
}
