import { Modal } from './modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`min-h-[40px] rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium transition-colors duration-150 ${
              destructive
                ? 'bg-[var(--color-danger-fill)] text-white hover:opacity-90'
                : 'bg-[var(--color-amber)] text-[var(--color-on-amber)] hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]'
            }`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="leading-relaxed text-[var(--color-text-muted)]">{description}</p>
    </Modal>
  );
}
