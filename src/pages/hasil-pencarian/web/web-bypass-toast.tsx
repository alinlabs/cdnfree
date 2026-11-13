import { ShieldCheck, X } from 'lucide-react';

interface WebBypassToastProps {
  host: string | null;
  onDismiss: () => void;
}

export function WebBypassToast({ host, onDismiss }: WebBypassToastProps) {
  if (!host) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-40 flex max-w-xs items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#141414] px-3 py-2 text-xs text-white shadow-[0_10px_28px_rgba(0,0,0,0.3)]"
    >
      <ShieldCheck
        size={15}
        aria-hidden="true"
        className="shrink-0 text-[var(--color-amber)]"
      />
      <span className="truncate">
        Keluar-link dibypass: <strong className="font-semibold">{host}</strong>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Tutup notifikasi bypass"
        className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-white/70 hover:text-white"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
