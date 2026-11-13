import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Upload } from 'lucide-react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { EmptyState } from '../../components/empty-state';
import { PageContainer } from '../../components/page-container';
import { useBookmarks } from '../../hooks/use-bookmarks';
import { bookmarkToResourceRecord } from '../../services/bookmark-service';
import type { BookmarkImportResult } from '../../types/bookmark';
import { getAssetFilename } from '../../utils/asset-explorer';
import { resolveFullViewIndex } from '../hasil-pencarian/aset/asset-filters';
import { ImageGallery } from '../hasil-pencarian/aset/image-gallery';
import { VideoGallery } from '../hasil-pencarian/aset/video-gallery';
import { MediaFullView } from '../hasil-pencarian/media-player';
import { MarkahImportModal } from './markah-import-modal';
import { MarkahToolbar, type MarkahKindFilter } from './markah-toolbar';

interface ActiveMarkahFullView {
  kind: 'image' | 'video';
  itemKey: string;
}

export function MarkahPage() {
  const { bookmarks, storageError, clearAll, exportJson, importJson } =
    useBookmarks();

  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<MarkahKindFilter>('all');
  const [fullView, setFullView] = useState<ActiveMarkahFullView | null>(null);
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

  const imageResources = useMemo(
    () =>
      filteredBookmarks
        .filter((item) => item.kind === 'image')
        .map(bookmarkToResourceRecord),
    [filteredBookmarks],
  );

  const videoResources = useMemo(
    () =>
      filteredBookmarks
        .filter((item) => item.kind === 'video')
        .map(bookmarkToResourceRecord),
    [filteredBookmarks],
  );

  const handleExportJson = () => {
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
  };

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
      ? imageResources
      : fullView?.kind === 'video'
        ? videoResources
        : [];
  const fullViewIndex =
    fullView && fullViewItems.length > 0
      ? resolveFullViewIndex(fullViewItems, fullView.itemKey)
      : -1;

  const showImages =
    kindFilter === 'image' || (kindFilter === 'all' && imageResources.length > 0);
  const showVideos =
    kindFilter === 'video' || (kindFilter === 'all' && videoResources.length > 0);

  return (
    <PageContainer className="py-8 sm:py-10">
      <div className="space-y-6">
        <div className="border-b border-[var(--color-border)] pb-5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber-soft)] text-[var(--color-amber-strong)]">
              <Bookmark size={17} aria-hidden="true" className="fill-current" />
            </span>
            <h1 className="text-2xl font-semibold tracking-[-0.015em] text-[var(--color-text)] sm:text-[28px]">
              Markah media
            </h1>
          </div>
          <p className="mt-2 max-w-[72ch] text-sm text-[var(--color-text-muted)]">
            Koleksi tautan gambar dan video yang tersimpan secara lokal di peramban ini. Hanya alamat tautan aset yang disimpan sehingga ringan dan mudah diekspor atau diimpor dalam format JSON.
          </p>
        </div>

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

        <MarkahToolbar
          query={query}
          onQueryChange={setQuery}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          totalCount={bookmarks.length}
          imageCount={imageCount}
          videoCount={videoCount}
          filteredCount={filteredBookmarks.length}
          onExportJson={handleExportJson}
          onOpenImportModal={() => setImportModalOpen(true)}
          onRequestClearAll={() => setConfirmClearOpen(true)}
        />

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
                  onClick={() => setImportModalOpen(true)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
                >
                  <Upload size={15} aria-hidden="true" />
                  <span>Impor JSON</span>
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
            {showImages ? (
              <ImageGallery
                inspectionId=""
                images={imageResources}
                onOpenFullView={(index) => {
                  const target = imageResources[index];
                  if (target) {
                    setFullView({ kind: 'image', itemKey: target.id });
                  }
                }}
              />
            ) : null}

            {showVideos ? (
              <VideoGallery
                inspectionId=""
                videos={videoResources}
                onOpenFullView={(resourceId) => {
                  setFullView({ kind: 'video', itemKey: resourceId });
                }}
              />
            ) : null}
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
              setFullView({ kind: fullView.kind, itemKey: nextItem.id });
            }
          }}
          onClose={() => setFullView(null)}
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
          setFullView(null);
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
