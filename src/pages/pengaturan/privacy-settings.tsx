import { SettingSwitch } from '../../components/setting-switch';
import type { HistoryRetentionDays, PrivacySettings } from '../../types/settings';

interface PrivacySettingsProps {
  privacy: PrivacySettings;
  onUpdatePrivacy: (patch: {
    saveLocalHistory?: boolean;
    historyRetentionDays?: HistoryRetentionDays;
  }) => void;
}

export function PrivacySettingsSection({
  privacy,
  onUpdatePrivacy,
}: PrivacySettingsProps) {
  return (
    <section
      aria-labelledby="penyimpanan-heading"
      className="space-y-3"
    >
      <h2
        id="penyimpanan-heading"
        className="text-lg font-bold tracking-wide text-[var(--color-text)] uppercase"
      >
        PENYIMPANAN
      </h2>

      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-4 py-3.5">
          <div className="space-y-1">
            <label
              id="setting-save-history-label"
              htmlFor="setting-save-history"
              className="block cursor-pointer text-sm font-medium text-[var(--color-text)]"
            >
              Simpan riwayat pemeriksaan secara lokal
            </label>
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
              Jika dimatikan, pemeriksaan baru tidak akan dicatat ke daftar Riwayat pencarian.
            </p>
          </div>
          <SettingSwitch
            id="setting-save-history"
            checked={privacy.saveLocalHistory}
            onChange={(checked) =>
              onUpdatePrivacy({ saveLocalHistory: checked })
            }
            labelledBy="setting-save-history-label"
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
    </section>
  );
}
