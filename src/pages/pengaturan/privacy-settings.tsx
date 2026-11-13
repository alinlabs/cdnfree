import { useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import type { HistoryRetentionDays, PrivacySettings } from '../../types/settings';

interface PrivacySettingsProps {
  privacy: PrivacySettings;
  historyCount: number;
  onUpdatePrivacy: (patch: {
    saveLocalHistory?: boolean;
    historyRetentionDays?: HistoryRetentionDays;
  }) => void;
  onClearHistory: () => void;
  onResetAllData: () => void;
}

export function PrivacySettingsSection({
  privacy,
  historyCount,
  onUpdatePrivacy,
  onClearHistory,
  onResetAllData,
}: PrivacySettingsProps) {
  const [confirmClearHistoryOpen, setConfirmClearHistoryOpen] = useState(false);
  const [confirmResetAllOpen, setConfirmResetAllOpen] = useState(false);

  return (
    <section
      aria-labelledby="privasi-heading"
      className="space-y-4 border-b border-[var(--color-border)] pb-6"
    >
      <div>
        <h2
          id="privasi-heading"
          className="text-base font-semibold text-[var(--color-text)]"
        >
          Privasi & penyimpanan lokal
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
          CDNFREE tidak menyimpan kuki, kredensial, atau isi HTML halaman di peramban Anda. Parameter kueri sensitif disamarkan sebelum disimpan.
        </p>
      </div>

      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-4 py-3.5">
          <div className="space-y-1">
            <label
              htmlFor="setting-save-history"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Simpan riwayat pemeriksaan secara lokal
            </label>
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
              Jika dimatikan, pemeriksaan baru tidak akan dicatat ke daftar Riwayat pencarian.
            </p>
          </div>
          <input
            id="setting-save-history"
            type="checkbox"
            checked={privacy.saveLocalHistory}
            onChange={(event) =>
              onUpdatePrivacy({ saveLocalHistory: event.target.checked })
            }
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-amber-strong)]"
          />
        </div>

        <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <label
              htmlFor="setting-retention"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Masa simpan riwayat lokal
            </label>
            <p className="text-xs text-[var(--color-text-muted)]">
              Entri yang lebih lama dari batas ini dibersihkan otomatis saat halaman dimuat.
            </p>
          </div>

          <select
            id="setting-retention"
            value={privacy.historyRetentionDays}
            onChange={(event) =>
              onUpdatePrivacy({
                historyRetentionDays: Number(
                  event.target.value,
                ) as HistoryRetentionDays,
              })
            }
            className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
          >
            <option value={7}>7 hari</option>
            <option value={30}>30 hari</option>
            <option value={90}>90 hari</option>
            <option value={0}>Tanpa batas otomatis</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          disabled={historyCount === 0}
          onClick={() => setConfirmClearHistoryOpen(true)}
          className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-danger)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Hapus riwayat ({historyCount})
        </button>

        <button
          type="button"
          onClick={() => setConfirmResetAllOpen(true)}
          className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
        >
          Reset semua data & pengaturan
        </button>
      </div>

      <ConfirmDialog
        open={confirmClearHistoryOpen}
        onClose={() => setConfirmClearHistoryOpen(false)}
        onConfirm={onClearHistory}
        title="Hapus semua riwayat?"
        description="Seluruh riwayat URL yang tersimpan di peramban ini akan dihapus permanen."
        confirmLabel="Hapus riwayat"
        cancelLabel="Batal"
        destructive
      />

      <ConfirmDialog
        open={confirmResetAllOpen}
        onClose={() => setConfirmResetAllOpen(false)}
        onConfirm={onResetAllData}
        title="Reset semua data lokal CDNFREE?"
        description="Riwayat pencarian, daftar pengecualian host, dan seluruh preferensi perlindungan di perangkat ini akan dikembalikan ke pengaturan awal."
        confirmLabel="Reset semua data"
        cancelLabel="Batal"
        destructive
      />
    </section>
  );
}
