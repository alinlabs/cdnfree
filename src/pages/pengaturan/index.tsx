import { PageContainer } from '../../components/page-container';
import { useHistory } from '../../hooks/use-history';
import { useSettings } from '../../hooks/use-settings';
import type { HistoryRetentionDays } from '../../types/settings';
import { AppearanceSettingsSection } from './appearance-settings';
import { FilterSettingsSection } from './filter-settings';
import { PrivacySettingsSection } from './privacy-settings';
import { ProtectionSettingsSection } from './protection-settings';

export function PengaturanPage() {
  const {
    settings,
    storageError: settingsError,
    updateTheme,
    updateProtection,
    updatePrivacy,
    addAllowlistedHost,
    removeAllowlistedHost,
    resetAllSettings,
  } = useSettings();
  const {
    entries,
    storageError: historyError,
    pruneByRetention,
    clearAll,
  } = useHistory();

  const handleUpdatePrivacy = (patch: {
    saveLocalHistory?: boolean;
    historyRetentionDays?: HistoryRetentionDays;
  }) => {
    updatePrivacy(patch);
    if (
      typeof patch.historyRetentionDays === 'number' &&
      patch.historyRetentionDays > 0
    ) {
      pruneByRetention(patch.historyRetentionDays);
    }
  };

  const handleResetAllData = () => {
    clearAll();
    resetAllSettings();
  };

  const combinedStorageError = settingsError || historyError;

  return (
    <PageContainer className="py-8 sm:py-10">
      <div className="space-y-8">
        <div className="border-b border-[var(--color-border)] pb-5">
          <h1 className="text-2xl font-semibold tracking-[-0.015em] text-[var(--color-text)] sm:text-[28px]">
            Pengaturan
          </h1>
          <p className="mt-1.5 max-w-[72ch] text-sm text-[var(--color-text-muted)]">
            Kelola tema tampilan, perilaku inspeksi tautan, pengecualian host, dan penyimpanan riwayat lokal.
          </p>
        </div>

        {combinedStorageError ? (
          <div
            role="alert"
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3.5 text-xs font-medium text-[var(--color-danger)]"
          >
            {combinedStorageError}
          </div>
        ) : null}

        <AppearanceSettingsSection
          theme={settings.theme}
          onUpdateTheme={updateTheme}
        />

        <ProtectionSettingsSection
          protection={settings.protection}
          onUpdate={updateProtection}
        />

        <FilterSettingsSection
          allowlistedHosts={settings.allowlistedHosts}
          onAddHost={addAllowlistedHost}
          onRemoveHost={removeAllowlistedHost}
        />

        <PrivacySettingsSection
          privacy={settings.privacy}
          historyCount={entries.length}
          onUpdatePrivacy={handleUpdatePrivacy}
          onClearHistory={clearAll}
          onResetAllData={handleResetAllData}
        />

        <section aria-labelledby="tentang-heading" className="space-y-2">
          <h2
            id="tentang-heading"
            className="text-base font-semibold text-[var(--color-text)]"
          >
            Tentang CDNFREE
          </h2>
          <p className="max-w-[72ch] text-sm leading-relaxed text-[var(--color-text-muted)]">
            Versi 0.1.0. CDNFREE menyediakan inspeksi tautan publik berbasis server dengan validasi SSRF, penelusuran rantai pengalihan, inventaris aset HTML statis, pencocokan subset daftar filter jaringan, serta pengunduhan aset publik tervalidasi atas izin pengguna.
          </p>
        </section>
      </div>
    </PageContainer>
  );
}
