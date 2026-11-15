import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { SettingSwitch } from '../../components/setting-switch';
import { useSmartCacheManager } from '../../hooks/use-smart-cache-sw';
import type {
  HistoryRetentionDays,
  PrivacySettings,
  VideoCacheLimitMb,
} from '../../types/settings';
import { formatBytes } from '../../utils/format-bytes';

interface PrivacySettingsProps {
  privacy: PrivacySettings;
  onUpdatePrivacy: (patch: {
    saveLocalHistory?: boolean;
    historyRetentionDays?: HistoryRetentionDays;
    videoCacheLimitMb?: VideoCacheLimitMb;
  }) => void;
}

export function PrivacySettingsSection({
  privacy,
  onUpdatePrivacy,
}: PrivacySettingsProps) {
  const { entries, stats, clearCache } = useSmartCacheManager();
  const [clearingVideoCache, setClearingVideoCache] = useState(false);

  const handleClearVideoCache = async () => {
    if (clearingVideoCache || entries.length === 0) return;
    setClearingVideoCache(true);
    try {
      await clearCache();
    } finally {
      setClearingVideoCache(false);
    }
  };

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

        <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <label
              htmlFor="setting-video-cache-limit"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Batas cache video offline
            </label>
            <p className="text-xs text-[var(--color-text-muted)]">
              Batas maksimum penyimpanan otomatis video offline (SmartCache) di peramban.
            </p>
          </div>

          <select
            id="setting-video-cache-limit"
            value={privacy.videoCacheLimitMb}
            onChange={(event) =>
              onUpdatePrivacy({
                videoCacheLimitMb: Number(
                  event.target.value,
                ) as VideoCacheLimitMb,
              })
            }
            className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
          >
            <option value={256}>256 MB</option>
            <option value={512}>512 MB</option>
            <option value={1024}>1 GB</option>
            <option value={1536}>1,5 GB</option>
            <option value={2048}>2 GB</option>
          </select>
        </div>

        <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--color-text)]">
              Cache video offline (SmartCache)
            </p>
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)] tabular-nums">
              {stats.completeEntries} video tersimpan · {formatBytes(stats.totalBytes)} dari batas{' '}
              {formatBytes(stats.budgetBytes)}
            </p>
          </div>

          <button
            type="button"
            disabled={clearingVideoCache || entries.length === 0}
            onClick={() => void handleClearVideoCache()}
            className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-danger)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={14} aria-hidden="true" />
            <span>Hapus cache video</span>
          </button>
        </div>
      </div>
    </section>
  );
}
