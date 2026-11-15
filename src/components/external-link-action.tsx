import { useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from './modal';
import { redactUrlForDisplay } from '../utils/redact-url';
import { validateExternalNavigationUrl } from '../utils/safe-external-url';

interface ExternalLinkActionProps {
  url: string;
  label: string;
  warningText?: string;
  variant?: 'primary' | 'secondary' | 'text';
  className?: string;
  showIcon?: boolean;
  direct?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  children?: ReactNode;
}

export function ExternalLinkAction({
  url,
  label,
  warningText,
  variant = 'secondary',
  className = '',
  showIcon = true,
  direct = false,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  children,
}: ExternalLinkActionProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof controlledOpen === 'boolean';
  const confirmOpen = isControlled ? controlledOpen : internalOpen;
  const setConfirmOpen = (next: boolean) => {
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  const validation = validateExternalNavigationUrl(url);
  const displayUrl = redactUrlForDisplay(url);

  const baseVariantClasses =
    variant === 'primary'
      ? 'min-h-[40px] rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)] hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]'
      : variant === 'secondary'
        ? 'min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]'
        : 'min-h-[36px] py-1 text-xs font-medium text-[var(--color-text-muted)] underline-offset-4 hover:text-[var(--color-text)] hover:underline';

  if (!validation.safe || !validation.url) {
    if (hideTrigger) return null;
    return (
      <span
        className="text-xs text-[var(--color-text-soft)]"
        title={validation.reason}
      >
        Tautan tidak dapat dibuka
      </span>
    );
  }

  if (direct) {
    if (hideTrigger) return null;
    return (
      <a
        href={validation.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center justify-center gap-1.5 transition-colors duration-150 ${baseVariantClasses} ${className}`}
      >
        {children ?? label}
        {showIcon ? <ExternalLink size={14} aria-hidden="true" /> : null}
      </a>
    );
  }

  return (
    <>
      {!hideTrigger ? (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className={`inline-flex items-center justify-center gap-1.5 transition-colors duration-150 ${baseVariantClasses} ${className}`}
        >
          {children ?? label}
          {showIcon ? <ExternalLink size={14} aria-hidden="true" /> : null}
        </button>
      ) : null}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Konfirmasi buka situs eksternal"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
            >
              Batal
            </button>
            <a
              href={validation.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setConfirmOpen(false)}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
            >
              <span>Buka situs di tab baru</span>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </>
        }
      >
        <div className="space-y-3">
          <p className="leading-relaxed text-[var(--color-text-muted)]">
            Anda akan meninggalkan CDNFREE dan membuka alamat berikut secara langsung di tab baru:
          </p>

          <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
            <p className="text-xs font-medium text-[var(--color-text-soft)]">
              Host tujuan: {validation.host}
            </p>
            <p className="mt-1 break-all text-xs text-[var(--color-text)] tabular-nums">
              {displayUrl}
            </p>
          </div>

          {warningText ? (
            <p className="text-xs leading-relaxed font-medium text-[var(--color-danger)]">
              Catatan kehati-hatian: {warningText}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
              CDNFREE tidak mengontrol skrip, kuki, atau konten dinamis setelah Anda membuka situs tersebut di luar halaman ini.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
