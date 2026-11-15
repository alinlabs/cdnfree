import type { ReactNode } from 'react';
import { Check, Copy, Download, ExternalLink, RotateCcw } from 'lucide-react';
import { formatBytes } from '../../../utils/format-bytes';

interface MediaPlayerErrorProps {
  icon: ReactNode;
  title: string;
  description: string;
  filename: string;
  declaredBytes?: number;
  canDownload: boolean;
  isDownloading: boolean;
  copied: boolean;
  onDownload: () => void;
  onCopy: () => void;
  onPlayDirect?: () => void;
  playDirectLabel?: string;
  onRetry?: () => void;
}

export function MediaPlayerError({
  icon,
  title,
  description,
  filename,
  declaredBytes,
  canDownload,
  isDownloading,
  copied,
  onDownload,
  onCopy,
  onPlayDirect,
  playDirectLabel = 'Putar langsung',
  onRetry,
}: MediaPlayerErrorProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[var(--color-surface-subtle)] p-6 text-center">
      <div className="max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <div className="mx-auto flex justify-center text-[var(--color-text-soft)]">
          {icon}
        </div>
        <h3 className="mt-3 text-base font-semibold text-[var(--color-text)]">
          {title}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {description}
        </p>
        <p className="mt-2 truncate text-xs text-[var(--color-text-soft)] tabular-nums">
          {filename} · {formatBytes(declaredBytes)}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onPlayDirect ? (
            <button
              type="button"
              onClick={onPlayDirect}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-xs font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
            >
              <ExternalLink size={14} aria-hidden="true" />
              <span>{playDirectLabel}</span>
            </button>
          ) : null}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>Coba lagi</span>
            </button>
          ) : null}
          {canDownload ? (
            <button
              type="button"
              disabled={isDownloading}
              onClick={onDownload}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-xs font-semibold transition-colors duration-150 disabled:opacity-60 ${
                onPlayDirect
                  ? 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]'
                  : 'bg-[var(--color-amber)] text-[var(--color-on-amber)] hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]'
              }`}
            >
              <Download size={14} aria-hidden="true" />
              <span>{isDownloading ? 'Mengunduh...' : 'Unduh aset'}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            {copied ? (
              <Check size={14} aria-hidden="true" className="text-[var(--color-success)]" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
            <span>{copied ? 'Tautan tersalin' : 'Salin tautan'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
