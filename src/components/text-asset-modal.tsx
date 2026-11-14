import { useEffect, useId, useState } from 'react';

interface TextPreviewSurfaceProps {
  src: string;
  mimeType?: string;
  compactHeight?: boolean;
}

const MAX_TEXT_PREVIEW_CHARS = 65_536;

export function TextPreviewSurface({
  src,
  mimeType,
  compactHeight = false,
}: TextPreviewSurfaceProps) {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setTruncated(false);

    async function fetchText() {
      try {
        const res = await fetch(src, { signal: controller.signal });
        if (!res.ok) {
          setError(`Gagal memuat pratinjau teks (HTTP ${res.status}).`);
          setLoading(false);
          return;
        }
        const raw = await res.text();
        if (controller.signal.aborted) return;

        let formatted = raw;
        if (mimeType?.includes('json')) {
          try {
            formatted = JSON.stringify(JSON.parse(raw), null, 2);
          } catch {
            formatted = raw;
          }
        }

        if (formatted.length > MAX_TEXT_PREVIEW_CHARS) {
          setContent(formatted.slice(0, MAX_TEXT_PREVIEW_CHARS));
          setTruncated(true);
        } else {
          setContent(formatted);
        }
        setLoading(false);
      } catch {
        if (!controller.signal.aborted) {
          setError('Tidak dapat mengambil isi berkas untuk pratinjau.');
          setLoading(false);
        }
      }
    }

    void fetchText();
    return () => controller.abort();
  }, [src, mimeType]);

  if (loading) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-6 text-center text-xs text-[var(--color-text-muted)]">
        Memuat cuplikan teks...
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-xs text-[var(--color-danger)]"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {truncated ? (
        <p className="text-xs text-[var(--color-text-soft)]">
          Menampilkan 64 KB pertama dari berkas teks.
        </p>
      ) : null}
      <pre
        className={`rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[#1C1C1C] p-3.5 text-xs leading-relaxed text-[#F5F5F5] whitespace-pre-wrap break-words ${
          compactHeight ? 'max-h-[55vh] overflow-auto' : 'overflow-x-auto'
        }`}
      >
        <code>{content || '(Berkas kosong)'}</code>
      </pre>
    </div>
  );
}

interface FontPreviewSurfaceProps {
  src: string;
  title: string;
}

export function FontPreviewSurface({ src, title }: FontPreviewSurfaceProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const familyName = `cdnfree-font-${rawId}`;
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setStatus('loading');

    async function loadFont() {
      try {
        if (typeof FontFace === 'undefined') {
          setStatus('error');
          return;
        }
        const face = new FontFace(familyName, `url(${src})`);
        const loaded = await face.load();
        if (!active) return;
        document.fonts.add(loaded);
        setStatus('loaded');
      } catch {
        if (active) setStatus('error');
      }
    }

    void loadFont();
    return () => {
      active = false;
    };
  }, [src, familyName]);

  if (status === 'error') {
    return (
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-xs text-[var(--color-text-muted)]">
        Berkas font tidak dapat dirender langsung oleh peramban.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
      <p className="text-xs text-[var(--color-text-soft)]">
        {status === 'loading' ? `Memuat font ${title}...` : `Sampel tipografi: ${title}`}
      </p>
      <div
        style={{ fontFamily: `'${familyName}', sans-serif` }}
        className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text)]"
      >
        <p className="text-2xl leading-snug">
          Aa Bb Cc Dd Ee Ff Gg 0123456789
        </p>
        <p className="text-base leading-relaxed">
          Pemeriksaan cepat font web CDNFREE untuk pratinjau huruf dan angka.
        </p>
        <p className="text-xs tracking-wide uppercase">
          ABCDEFGHIJKLMNOPQRSTUVWXYZ · !@#$%^&amp;*()
        </p>
      </div>
    </div>
  );
}
