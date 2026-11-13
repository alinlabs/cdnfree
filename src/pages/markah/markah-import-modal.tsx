import { useEffect, useRef, useState } from 'react';
import { FileJson, Upload } from 'lucide-react';
import { Modal } from '../../components/modal';
import type { BookmarkImportResult } from '../../types/bookmark';

interface MarkahImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (jsonText: string) => BookmarkImportResult;
}

export function MarkahImportModal({
  open,
  onClose,
  onImport,
}: MarkahImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jsonText, setJsonText] = useState('');
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setJsonText('');
      setSelectedFilename(null);
      setErrorMsg(null);
    }
  }, [open]);

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const content = await file.text();
      setJsonText(content);
      setSelectedFilename(file.name);
      setErrorMsg(null);
    } catch {
      setErrorMsg('Berkas JSON tidak dapat dibaca oleh peramban.');
    }
  };

  const handleSubmit = () => {
    const result = onImport(jsonText);
    if (!result.ok) {
      setErrorMsg(result.error ?? 'Impor JSON gagal.');
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Impor markah tautan media (JSON)"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={!jsonText.trim()}
            onClick={handleSubmit}
            className="min-h-[40px] rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Impor tautan
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          Pilih berkas JSON hasil ekspor CDNFREE atau tempel array JSON tautan media (contoh:{' '}
          <code className="rounded bg-[var(--color-surface-subtle)] px-1 py-0.5 font-mono text-[11px] text-[var(--color-text)]">
            [&quot;https://.../gambar.jpg&quot;, &quot;https://.../video.mp4&quot;]
          </code>
          ). Tautan lokal/privat ditolak otomatis dan duplikat dilewati.
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              void handleFileSelected(e);
            }}
            className="sr-only"
            aria-label="Pilih berkas JSON markah"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:border-[var(--color-border-strong)]"
          >
            <Upload size={14} aria-hidden="true" />
            <span>Pilih berkas .json</span>
          </button>

          {selectedFilename ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <FileJson size={14} aria-hidden="true" />
              <span className="max-w-[24ch] truncate">{selectedFilename}</span>
            </span>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="markah-import-json-input"
            className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]"
          >
            Atau tempel konten JSON di sini
          </label>
          <textarea
            id="markah-import-json-input"
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setErrorMsg(null);
            }}
            rows={6}
            spellCheck={false}
            placeholder={`{\n  "bookmarks": [\n    "https://contoh.com/foto.jpg",\n    "https://contoh.com/klip.mp4"\n  ]\n}`}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-border-strong)] focus:outline-none"
          />
        </div>

        {errorMsg ? (
          <p
            role="alert"
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2.5 text-xs font-medium text-[var(--color-danger)]"
          >
            {errorMsg}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
