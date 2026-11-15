import { Bookmark } from 'lucide-react';
import type { ResourceDownloadState } from '../shared/use-resource-downloads';
import { AssetCardMenu } from './asset-card-menu';

interface VideoMiniCardOverlayProps {
  filename: string;
  cornerBadge: string;
  shortcutHud: string | null;
  unverified: boolean;
  isOfflineCached: boolean;
  hasStarted: boolean;
  isMenuOpen: boolean;
  menuAlignClassName: string;
  eligibleForDownload: boolean;
  downloadState: ResourceDownloadState;
  copied: boolean;
  isBookmarked: boolean;
  onToggleBookmark?: () => void;
  onToggleMenu: () => void;
  onOpenInfo: () => void;
  onCopy: () => void;
  onDownload: () => void;
  menuContainerRef: (node: HTMLDivElement | null) => void;
}

export function VideoMiniCardOverlay({
  filename,
  cornerBadge,
  shortcutHud,
  unverified,
  isOfflineCached,
  hasStarted,
  isMenuOpen,
  menuAlignClassName,
  eligibleForDownload,
  downloadState,
  copied,
  isBookmarked,
  onToggleBookmark,
  onToggleMenu,
  onOpenInfo,
  onCopy,
  onDownload,
  menuContainerRef,
}: VideoMiniCardOverlayProps) {
  return (
    <>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-[30%] rounded-t-[var(--radius-md)] bg-gradient-to-b from-black/60 via-black/25 to-transparent transition-opacity duration-150 ${
          isMenuOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
        }`}
      />

      <span
        className={`pointer-events-none absolute top-1.5 left-2 z-10 max-w-[calc(100%-3.75rem)] truncate text-[10px] font-medium text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] tabular-nums transition-opacity duration-150 sm:top-2 sm:left-2.5 sm:max-w-[calc(100%-4.5rem)] sm:text-[11px] ${
          isMenuOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
        }`}
      >
        {cornerBadge}
      </span>

      {shortcutHud ? (
        <span
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute top-1.5 left-1/2 z-20 -translate-x-1/2 rounded-[var(--radius-sm)] bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-white tabular-nums shadow-sm sm:top-2 sm:text-[11px]"
        >
          {shortcutHud}
        </span>
      ) : null}

      {unverified ? (
        <span className="pointer-events-none absolute bottom-1.5 left-2 z-10 truncate rounded-[2px] bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
          belum terverifikasi
        </span>
      ) : !hasStarted && isOfflineCached ? (
        <span className="pointer-events-none absolute bottom-1.5 left-2 z-10 rounded-[2px] bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-within/card:opacity-100">
          Offline
        </span>
      ) : null}

      <div
        className={`absolute top-1 right-1 z-20 flex items-center gap-0.5 transition-opacity duration-150 sm:top-2 sm:right-2 sm:gap-1 ${
          isMenuOpen
            ? 'opacity-100'
            : 'opacity-0 pointer-events-none group-hover/card:opacity-100 group-hover/card:pointer-events-auto group-focus-within/card:opacity-100 group-focus-within/card:pointer-events-auto'
        }`}
      >
        {onToggleBookmark ? (
          <button
            type="button"
            onClick={onToggleBookmark}
            aria-label={
              isBookmarked
                ? `Hapus ${filename} dari markah`
                : `Simpan ${filename} ke markah`
            }
            aria-pressed={isBookmarked}
            title={isBookmarked ? 'Tersimpan di markah (hapus)' : 'Simpan ke markah'}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-transparent p-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] transition-[color,transform] duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-[var(--color-amber)] sm:h-7 sm:w-7 ${
              isBookmarked ? 'text-[var(--color-amber)]' : 'text-white/90 hover:text-white'
            }`}
          >
            <Bookmark
              size={16}
              aria-hidden="true"
              className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isBookmarked ? 'fill-current' : ''}`}
            />
          </button>
        ) : null}

        <AssetCardMenu
          filename={filename}
          isOpen={isMenuOpen}
          alignClassName={menuAlignClassName}
          menuTitle="Opsi video"
          eligibleForDownload={eligibleForDownload}
          downloadState={downloadState}
          copied={copied}
          onToggle={onToggleMenu}
          onOpenInfo={onOpenInfo}
          onCopy={onCopy}
          onDownload={onDownload}
          containerRef={menuContainerRef}
          triggerSizeClass="h-6 w-6 sm:h-7 sm:w-7"
        />
      </div>
    </>
  );
}
