import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

interface PdfThumbnailProps {
  src: string;
  title: string;
  onPageCount?: (count: number) => void;
}

export function PdfThumbnail({ src, title, onPageCount }: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onPageCountRef = useRef(onPageCount);
  onPageCountRef.current = onPageCount;

  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');

  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let renderTask: pdfjsLib.RenderTask | null = null;
    let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;

    setStatus('loading');

    async function renderFirstPage() {
      try {
        loadingTask = pdfjsLib.getDocument({
          url: src,
          withCredentials: false,
        });
        pdfDoc = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        onPageCountRef.current?.(pdfDoc.numPages);

        const page = await pdfDoc.getPage(1);
        if (cancelled || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = 420;
        const scale = Math.min(2, Math.max(0.5, targetWidth / Math.max(1, baseViewport.width)));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });

        const canvas = canvasRef.current;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        const ctx = canvas.getContext('2d');
        renderTask = page.render({
          canvas,
          canvasContext: ctx ?? undefined,
          viewport,
        });
        await renderTask.promise;
        if (!cancelled) {
          setStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setStatus('fallback');
        }
      }
    }

    void renderFirstPage();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore cancel races
      }
      void loadingTask?.destroy();
      void pdfDoc?.cleanup();
    };
  }, [src]);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--color-surface-subtle)]">
      <canvas
        ref={canvasRef}
        aria-label={`Thumbnail halaman pertama ${title}`}
        className={`max-h-full max-w-full bg-white object-contain shadow-sm ${
          status === 'ready' ? 'block' : 'hidden'
        }`}
      />

      {status === 'loading' ? (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
          <FileText size={20} aria-hidden="true" className="text-[var(--color-text-soft)]" />
          <span className="text-[11px] text-[var(--color-text-muted)]">
            Membuat pratinjau PDF...
          </span>
        </div>
      ) : null}

      {status === 'fallback' ? (
        <iframe
          src={`${src}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`}
          title={`Pratinjau ${title}`}
          loading="lazy"
          className="pointer-events-none h-full w-full border-0 bg-white"
        />
      ) : null}
    </div>
  );
}

interface PdfViewerSurfaceProps {
  src: string;
  title: string;
  compactHeight?: boolean;
}

export function PdfViewerSurface({
  src,
  title,
  compactHeight = false,
}: PdfViewerSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'iframe-fallback'>('loading');
  const [viewMode, setViewMode] = useState<'canvas' | 'native'>('canvas');

  useEffect(() => {
    if (viewMode === 'native') return;
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    setStatus('loading');
    setPageNumber(1);
    setNumPages(0);

    async function loadPdf() {
      try {
        loadingTask = pdfjsLib.getDocument({
          url: src,
          withCredentials: false,
        });
        const loaded = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        docRef.current = loaded;
        setNumPages(loaded.numPages);
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setStatus('iframe-fallback');
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
      const currentDoc = docRef.current;
      docRef.current = null;
      void currentDoc?.cleanup();
    };
  }, [src, viewMode]);

  useEffect(() => {
    const doc = docRef.current;
    if (viewMode !== 'canvas' || status !== 'ready' || !doc || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    async function renderPage() {
      if (!doc || !canvasRef.current) return;
      try {
        const safePage = Math.min(Math.max(1, pageNumber), doc.numPages);
        const page = await doc.getPage(safePage);
        if (cancelled || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const containerWidth = Math.max(
          300,
          Math.min(820, (canvasRef.current.parentElement?.clientWidth || 720) - 24),
        );
        const baseScale = containerWidth / Math.max(1, baseViewport.width);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: baseScale * zoom * dpr });

        const canvas = canvasRef.current;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        const ctx = canvas.getContext('2d');
        renderTask = page.render({
          canvas,
          canvasContext: ctx ?? undefined,
          viewport,
        });
        await renderTask.promise;
      } catch {
        if (!cancelled) {
          setStatus('iframe-fallback');
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore cancel races
      }
    };
  }, [pageNumber, zoom, status, viewMode]);

  const heightClass = compactHeight
    ? 'h-[54dvh] min-h-[300px] max-h-[620px] overflow-auto'
    : 'min-h-[340px] overflow-x-auto';

  if (viewMode === 'native' || status === 'iframe-fallback') {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs">
          <span className="font-medium text-[var(--color-text)]">
            Penampil PDF bawaan peramban
          </span>
          {status !== 'iframe-fallback' ? (
            <button
              type="button"
              onClick={() => setViewMode('canvas')}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]"
            >
              Mode kanvas PDF.js
            </button>
          ) : null}
        </div>
        <iframe
          src={`${src}#view=FitH`}
          title={`Pratinjau dokumen ${title}`}
          className={`block w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white ${
            compactHeight ? 'h-[54dvh] min-h-[300px] max-h-[620px]' : 'h-[80dvh] min-h-[480px]'
          }`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={pageNumber <= 1 || status !== 'ready'}
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            aria-label="Halaman sebelumnya"
            className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs font-medium text-[var(--color-text)] disabled:opacity-45"
          >
            <ChevronLeft size={14} aria-hidden="true" />
            <span>Prev</span>
          </button>
          <span className="px-2 text-xs font-medium text-[var(--color-text)] tabular-nums">
            {numPages > 0 ? `Hal ${pageNumber} / ${numPages}` : 'Memuat PDF...'}
          </span>
          <button
            type="button"
            disabled={numPages === 0 || pageNumber >= numPages || status !== 'ready'}
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
            aria-label="Halaman berikutnya"
            className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs font-medium text-[var(--color-text)] disabled:opacity-45"
          >
            <span>Next</span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={zoom <= 0.6}
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.2).toFixed(2))))}
            aria-label="Perkecil zoom PDF"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] disabled:opacity-45"
          >
            <ZoomOut size={14} aria-hidden="true" />
          </button>
          <span className="min-w-[44px] text-center text-xs text-[var(--color-text-muted)] tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => Math.min(2, Number((z + 0.2).toFixed(2))))}
            aria-label="Perbesar zoom PDF"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] disabled:opacity-45"
          >
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('native')}
            className="ml-1 inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]"
          >
            Mode native
          </button>
        </div>
      </div>

      <div
        className={`rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-pdf-stage)] p-3 ${heightClass}`}
      >
        {status === 'loading' ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">
            Memuat dokumen PDF...
          </div>
        ) : (
          <div className="flex justify-center">
            <canvas
              ref={canvasRef}
              aria-label={`Halaman ${pageNumber} dari ${title}`}
              className="rounded-[2px] bg-white shadow-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}
