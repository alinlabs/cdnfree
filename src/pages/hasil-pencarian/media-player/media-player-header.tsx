import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  X,
} from 'lucide-react';
import { BrandWordmark } from '../../../components/brand-wordmark';
import { PageContainer } from '../../../components/page-container';
import { TopProgressLine } from '../../../components/top-progress-line';

interface MediaPlayerHeaderProps {
  filename: string;
  subtitle: string;
  totalItems: number;
  canDownload: boolean;
  isDownloading: boolean;
  copied: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  backLabel?: string;
  onPrev: () => void;
  onNext: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}

export function MediaPlayerHeader({
  filename,
  subtitle,
  totalItems,
  canDownload,
  isDownloading,
  copied,
  isBookmarked = false,
  onToggleBookmark,
  backLabel = 'Kembali ke Aset Manager',
  onPrev,
  onNext,
  onCopy,
  onDownload,
  onClose,
}: MediaPlayerHeaderProps) {
  return (
    <header className="relative z-30 shrink-0 border-b border-white/10 bg-[#0d0d10]/95 text-white">
      <PageContainer className="py-2.5 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              aria-label={backLabel}
              title={`${backLabel} (Esc)`}
              className="inline-flex h-8 w-6 -ml-1 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-white/75 transition-colors duration-150 hover:text-white"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>

            <div className="hidden sm:flex">
              <BrandWordmark size="md" />
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={backLabel}
            title={`${backLabel} (Esc)`}
            className="group flex min-h-9 min-w-0 flex-1 flex-col justify-center pl-1 text-left transition-colors duration-150 sm:border-l sm:border-white/10 sm:pl-3"
          >
            <h2
              className="block truncate text-sm font-semibold leading-tight text-white transition-colors duration-150 group-hover:text-[var(--color-amber)]"
              title={filename}
            >
              {filename}
            </h2>
            <p className="block truncate text-xs leading-tight text-white/60 tabular-nums">
              {subtitle}
            </p>
          </button>

          <div
            role="toolbar"
            aria-label="Kontrol pemutar media"
            className="flex shrink-0 items-center gap-1"
          >
            {totalItems > 1 ? (
              <>
                <button
                  type="button"
                  onClick={onPrev}
                  aria-label="Aset sebelumnya"
                  title="Sebelumnya (Panah kiri)"
                  className="hidden h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-white/75 transition-colors duration-150 hover:bg-white/10 hover:text-white sm:inline-flex"
                >
                  <ChevronLeft size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  aria-label="Aset berikutnya"
                  title="Berikutnya (Panah kanan)"
                  className="hidden h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-white/75 transition-colors duration-150 hover:bg-white/10 hover:text-white sm:inline-flex"
                >
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              </>
            ) : null}

            {onToggleBookmark ? (
              <button
                type="button"
                onClick={onToggleBookmark}
                aria-label={
                  isBookmarked ? 'Hapus dari markah' : 'Simpan ke markah'
                }
                aria-pressed={isBookmarked}
                title={
                  isBookmarked
                    ? 'Tersimpan di markah (klik untuk hapus)'
                    : 'Simpan ke markah'
                }
                className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
                  isBookmarked
                    ? 'bg-[var(--color-amber-soft)] text-[var(--color-amber)]'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Bookmark
                  size={17}
                  aria-hidden="true"
                  className={isBookmarked ? 'fill-current' : ''}
                />
              </button>
            ) : null}

            <button
              type="button"
              onClick={onCopy}
              aria-label={copied ? 'Tautan tersalin' : 'Salin tautan sumber'}
              title={copied ? 'Tautan tersalin' : 'Salin tautan'}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 ${
                copied
                  ? 'bg-[var(--color-amber-soft)] text-[var(--color-success)]'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              {copied ? (
                <Check size={17} aria-hidden="true" />
              ) : (
                <Copy size={17} aria-hidden="true" />
              )}
            </button>

            {canDownload ? (
              <button
                type="button"
                disabled={isDownloading}
                onClick={onDownload}
                aria-label={isDownloading ? 'Mengunduh aset...' : 'Unduh aset'}
                title={isDownloading ? 'Mengunduh...' : 'Unduh aset'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-white/75 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDownloading ? (
                  <Loader2
                    size={17}
                    aria-hidden="true"
                    className="animate-spin text-[var(--color-amber)]"
                  />
                ) : (
                  <Download size={17} aria-hidden="true" />
                )}
              </button>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup tampilan penuh"
              title="Tutup (Esc)"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-white/75 transition-colors duration-150 hover:bg-white/10 hover:text-white"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </PageContainer>

      <TopProgressLine
        visible={isDownloading}
        placement="header-bottom"
        label="Mengunduh aset..."
      />
    </header>
  );
}
