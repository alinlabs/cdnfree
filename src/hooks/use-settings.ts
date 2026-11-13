import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  SETTINGS_CHANGED_EVENT,
  loadSettings,
  normalizeAllowlistHostInput,
  resetSettings,
  saveSettings,
} from '../services/settings-service';
import type {
  HistoryRetentionDays,
  ProtectionSettings,
  SettingsState,
  ThemeMode,
} from '../types/settings';
import { applyThemeToDocument } from '../utils/theme';

export function useSettings() {
  const [settings, setSettings] = useState<SettingsState>(() => loadSettings().data);
  const [storageError, setStorageError] = useState<string | null>(null);
  const settingsRef = useRef<SettingsState>(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const initial = loadSettings();
    settingsRef.current = initial.data;
    setSettings(initial.data);
    setStorageError(initial.error ?? null);
    applyThemeToDocument(initial.data.theme);

    const handleStorage = () => {
      const refreshed = loadSettings();
      settingsRef.current = refreshed.data;
      setSettings(refreshed.data);
      setStorageError(refreshed.error ?? null);
      applyThemeToDocument(refreshed.data.theme);
    };

    const handleInTabSettingsChange = (event: Event) => {
      const detail = (event as CustomEvent<SettingsState>).detail;
      const next = detail ?? loadSettings().data;
      settingsRef.current = next;
      setSettings(next);
      applyThemeToDocument(next.theme);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(SETTINGS_CHANGED_EVENT, handleInTabSettingsChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleInTabSettingsChange);
    };
  }, []);

  const commitSettings = useCallback((next: SettingsState) => {
    const saved = saveSettings(next);
    settingsRef.current = saved.data;
    setSettings(saved.data);
    setStorageError(saved.error ?? null);
    applyThemeToDocument(saved.data.theme);
    return saved;
  }, []);

  const updateTheme = useCallback(
    (theme: ThemeMode) => {
      const current = settingsRef.current;
      commitSettings({
        ...current,
        theme,
      });
    },
    [commitSettings],
  );

  const updateProtection = useCallback(
    (patch: Partial<ProtectionSettings>) => {
      const current = settingsRef.current;
      commitSettings({
        ...current,
        protection: { ...current.protection, ...patch },
      });
    },
    [commitSettings],
  );

  const updatePrivacy = useCallback(
    (patch: {
      saveLocalHistory?: boolean;
      historyRetentionDays?: HistoryRetentionDays;
    }) => {
      const current = settingsRef.current;
      commitSettings({
        ...current,
        privacy: { ...current.privacy, ...patch },
      });
    },
    [commitSettings],
  );

  const addAllowlistedHost = useCallback(
    (rawHost: string): { ok: true; host: string } | { ok: false; message: string } => {
      const normalized = normalizeAllowlistHostInput(rawHost);
      if (!normalized.ok) {
        return normalized;
      }

      const current = settingsRef.current;
      if (current.allowlistedHosts.includes(normalized.host)) {
        return { ok: false, message: 'Host tersebut sudah ada di daftar pengecualian.' };
      }

      commitSettings({
        ...current,
        allowlistedHosts: [normalized.host, ...current.allowlistedHosts],
      });
      return { ok: true, host: normalized.host };
    },
    [commitSettings],
  );

  const removeAllowlistedHost = useCallback(
    (host: string) => {
      const current = settingsRef.current;
      commitSettings({
        ...current,
        allowlistedHosts: current.allowlistedHosts.filter((item) => item !== host),
      });
    },
    [commitSettings],
  );

  const resetAllSettings = useCallback(() => {
    const res = resetSettings();
    const next = res.data ?? DEFAULT_SETTINGS;
    settingsRef.current = next;
    setSettings(next);
    setStorageError(res.error ?? null);
    applyThemeToDocument(next.theme);
  }, []);

  return {
    settings,
    storageError,
    updateTheme,
    updateProtection,
    updatePrivacy,
    addAllowlistedHost,
    removeAllowlistedHost,
    resetAllSettings,
  };
}
