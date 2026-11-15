import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { EmptyState } from '../../components/empty-state';
import {
  useNavHeaderContext,
  type MarkahHeaderControls,
  type MarkahKindFilter,
} from '../../components/nav-header-context';
import { PageContainer } from '../../components/page-container';
import { useBookmarks } from '../../hooks/use-bookmarks';
import { bookmarkToResourceRecord } from '../../services/bookmark-service';
import type { BookmarkImportResult } from '../../types/bookmark';
import { getAssetFilename } from '../../utils/asset-explorer';
import {
  parseMediaFullViewParams,
  resolveFullViewIndex,
} from '../hasil-pencarian/aset/asset-filters';
import {
  MediaGalleriesGrid,
  splitGalleryMedia,
} from '../hasil-pencarian/aset/media-galleries-grid';
import { MediaFullView } from '../hasil-pencarian/media-player';
import { MarkahImportModal } from './markah-import-modal';

export function MarkahPage() {
  const {
    bookmarks,
    storageError,
    clearAll,
    restoreDefaults,
    exportJson,
    importJson,
  } = useBookmarks();

  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<MarkahKindFilter>('all');
  const fullView = useMemo(
    () =>
      parseMediaFullViewParams(
        searchParams.get('view'),
        searchParams.get('item'),
      ),
    [searchParams],
  );
  const openFullView = useCallback(
    (kind: 'image' | 'video', itemKey: string) => {
      const next = new URLSearchParams(searchParams);
      next.set('view', kind);
      next.set('item', itemKey);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const changeFullViewItem = useCallback(
    (itemKey: string) => {
      if (!fullView) return;
      const next = new URLSearchParams(searchParams);
      next.set('view', fullView.kind);
      next.set('item', itemKey);
      setSearchParams(next, { replace: true });
    },
    [fullView, searchParams, setSearchParams],
  );
  const closeFullView = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    next.delete('item');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{
    tone: 'success' | 'info';
    text: string;
  } | null>(null);

  const imageCount = useMemo(
    () => bookmarks.filter((item) => item.kind === 'image').length,
    [bookmarks],
  );
  const videoCount = useMemo(
    () => bookmarks.filter((item) => item.kind === 'video').length,
    [bookmarks],
  );

  const filteredBookmarks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookmarks.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) {
        return false;
      }
      if (!q) return true;
      const filename = getAssetFilename(item.url).toLowerCase();
      return (
        filename.includes(q) ||
        item.host.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        (item.title ?? '').toLowerCase().includes(q) ||
        (item.sourcePageUrl ?? '').toLowerCase().includes(q)
      );
    });
  }, [bookmarks, kindFilter, query]);

  const bookmarkResources = useMemo(
    () => filteredBookmarks.map(bookmarkToResourceRecord),
    [filteredBookmarks],
  );

  const {
    imageAssets,
    vectorAssets,
    allImageFullViewItems,
    validVideoAssets,
  } = useMemo(
    () => splitGalleryMedia(bookmarkResources),
    [bookmarkResources],
  );

  const { setMarkahControls } = useNavHeaderContext();

  const handleExportJson = useCallback(() => {
    const content = exportJson();
    const blob = new Blob([content], {
      type: 'application/json;charset=utf-8',
    });
    const objectUrl = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `cdnfree-markah-${today}.json`;
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    setStatusNotice({
      tone: 'success',
      text: `Berhasil mengekspor ${bookmarks.length} tautan markah ke berkas JSON.`,
    });
  }, [bookmarks.length, exportJson]);

  const headerControls = useMemo<MarkahHeaderControls>(
    () => ({
      query,
      onQueryChange: setQuery,
      kindFilter,
      onKindFilterChange: setKindFilter,
      totalCount: bookmarks.length,
      imageCount,
      videoCount,
      filteredCount: filteredBookmarks.length,
      onExportJson: handleExportJson,
      onOpenImportModal: () => setImportModalOpen(true),
      onRequestClearAll: () => setConfirmClearOpen(true),
    }),
    [
      query,
      kindFilter,
      bookmarks.length,
      imageCount,
      videoCount,
      filteredBookmarks.length,
      handleExportJson,
    ],
  );

  useEffect(() => {
    setMarkahControls(headerControls);
  }, [headerControls, setMarkahControls]);

  useEffect(() => {
    return () => setMarkahControls(null);
  }, [setMarkahControls]);

  const handleImportJson = (jsonText: string): BookmarkImportResult => {
    const result = importJson(jsonText);
    if (result.ok) {
      const parts = [`${result.added} tautan ditambahkan`];
      if (result.skippedDuplicates > 0) {
        parts.push(`${result.skippedDuplicates} duplikat dilewati`);
      }
      if (result.skippedInvalid > 0) {
        parts.push(`${result.skippedInvalid} tautan tidak valid dilewati`);
      }
      setStatusNotice({
        tone: result.added > 0 ? 'success' : 'info',
        text: `Impor selesai: ${parts.join(', ')}.`,
      });
    }
    return result;
  };

  const fullViewItems =
    fullView?.kind === 'image'
      ? allImageFullViewItems
      : fullView?.kind === 'video'
        ? validVideoAssets
        : [];
  const fullViewIndex =
    fullView && fullViewItems.length > 0
      ? resolveFullViewIndex(fullViewItems, fullView.itemKey)
      : -1;

  const showImages =
    kindFilter === 'image'
      ? imageAssets.length > 0 || vectorAssets.length === 0
      : kindFilter === 'all' && imageAssets.length > 0;
  const showVectors =
    (kindFilter === 'image' || kindFilter === 'all') && vectorAssets.length > 0;
  const showVideos =
    kindFilter === 'video' || (kindFilter === 'all' && validVideoAssets.length > 0);

  return (
    <PageContainer className="py-5 sm:py-6">
      <div className="space-y-6">

        {storageError ? (
          <div
            role="alert"
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3.5 text-xs font-medium text-[var(--color-danger)]"
          >
            {storageError}
          </div>
        ) : null}

        {statusNotice ? (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3.5 py-2.5 text-xs text-[var(--color-text)]"
          >
            <span
              className={
                statusNotice.tone === 'success'
                  ? 'font-medium text-[var(--color-success)]'
                  : 'text-[var(--color-text-muted)]'
              }
            >
              {statusNotice.text}
            </span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-xs font-medium text-[var(--color-text-soft)] hover:text-[var(--color-text)]"
            >
              Tutup
            </button>
          </div>
        ) : null}

        {bookmarks.length === 0 ? (
          <EmptyState
            title="Belum ada media yang dimarkahi"
            description="Klik ikon markah pada kartu gambar atau video di Aset Manager, atau dari bilah atas pemutar Full View, untuk menyimpan tautan medianya ke daftar ini."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Link
                  to="/"
                  className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
                >
                  Cari aset di Beranda
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    const res = restoreDefaults();
                    if (res.ok) {
                      setStatusNotice({
                        tone: 'success',
                        text: 'Dua media bawaan (logo.webp & into-landscape.mp4) dimuat ulang ke Markah.',
                      });
                    }
                  }}
                  className="inline-flex min-h-[40px] items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
                >
                  Muat media bawaan
                </button>
              </div>
            }
          />
        ) : filteredBookmarks.length === 0 ? (
          <EmptyState
            title="Tidak ada markah yang cocok"
            description="Ubah kata kunci pencarian atau pilih tab jenis media lain untuk melihat markah tersimpan."
            action={
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setKindFilter('all');
                }}
                className="inline-flex min-h-[38px] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
              >
                Reset filter
              </button>
            }
          />
        ) : (
          <div className="space-y-7">
            <MediaGalleriesGrid
              inspectionId=""
              imageAssets={imageAssets}
              vectorAssets={vectorAssets}
              validVideoAssets={validVideoAssets}
              showImages={showImages}
              showVectors={showVectors}
              showVideos={showVideos}
              onOpenFullView={openFullView}
            />
          </div>
        )}
      </div>

      {fullView && fullViewIndex >= 0 ? (
        <MediaFullView
          inspectionId=""
          mediaKind={fullView.kind}
          items={fullViewItems}
          activeIndex={fullViewIndex}
          backLabel="Kembali ke Markah Media"
          onChangeIndex={(nextIndex) => {
            const nextItem = fullViewItems[nextIndex];
            if (nextItem) {
              changeFullViewItem(nextItem.id);
            }
          }}
          onClose={closeFullView}
        />
      ) : null}

      <MarkahImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImportJson}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          clearAll();
          closeFullView();
          setStatusNotice({
            tone: 'info',
            text: 'Seluruh markah media lokal telah dihapus.',
          });
        }}
        title="Hapus semua markah media?"
        description="Seluruh tautan gambar dan video yang tersimpan di halaman Markah peramban ini akan dihapus permanen. Ekspor JSON terlebih dahulu bila Anda ingin menyimpannya."
        confirmLabel="Hapus semua"
        cancelLabel="Batal"
        destructive
      />
    </PageContainer>
  );
}
