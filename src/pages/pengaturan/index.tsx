import { PageContainer } from '../../components/page-container';
import { useHistory } from '../../hooks/use-history';
import { useSettings } from '../../hooks/use-settings';
import type { HistoryRetentionDays } from '../../types/settings';
import { AppearanceSettingsSection } from './appearance-settings';
import { PrivacySettingsSection } from './privacy-settings';
import { ProtectionSettingsSection } from './protection-settings';

export function PengaturanPage() {
  const {
    settings,
    storageError: settingsError,
    updateTheme,
    updateProtection,
    updatePrivacy,
  } = useSettings();
  const {
    storageError: historyError,
    pruneByRetention,
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

  const combinedStorageError = settingsError || historyError;

  return (
    <PageContainer className="py-5 sm:py-6">
      <div className="space-y-8">

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

        <PrivacySettingsSection
          privacy={settings.privacy}
          onUpdatePrivacy={handleUpdatePrivacy}
        />

        <section aria-labelledby="tentang-heading" className="space-y-3">
          <h2
            id="tentang-heading"
            className="text-lg font-bold tracking-wide text-[var(--color-text)] uppercase"
          >
            TENTANG
          </h2>
          <p className="w-full text-sm leading-relaxed text-[var(--color-text-muted)]">
            Versi 0.1.0. CDNFREE menyediakan inspeksi tautan publik berbasis server dengan validasi SSRF, penelusuran rantai pengalihan, inventaris aset HTML statis, pencocokan subset daftar filter jaringan, serta pengunduhan aset publik tervalidasi atas izin pengguna.
          </p>
        </section>
      </div>
    </PageContainer>
  );
}
