import { z } from 'zod';
import type {
  FilterRefreshResponse,
  FilterSourceStatus,
  HistoryRetentionDays,
  SettingsState,
} from '../types/settings';
import type { StorageLike } from './history-service';
import { isProhibitedHostname } from '../utils/normalize-url';
import { applyThemeToDocument, resolveThemeMode } from '../utils/theme';

export const SETTINGS_STORAGE_KEY = 'cdnfree:settings:v1';
export const SETTINGS_CHANGED_EVENT = 'cdnfree:settings-changed';
export const MAX_ALLOWLIST_HOSTS = 100;

export const DEFAULT_SETTINGS: SettingsState = {
  version: 1,
  theme: 'dark',
  protection: {
    enableFilterMatching: true,
    warnSuspiciousLinks: true,
    rejectProtocolDowngrade: false,
    bypassExternalLinks: true,
  },
  privacy: {
    saveLocalHistory: true,
    historyRetentionDays: 30,
  },
  allowlistedHosts: [],
};

const FilterSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string(),
  sourceUrl: z.string(),
  attribution: z.string(),
  license: z.string(),
  updatedAt: z.string(),
  fetchedAt: z.string().nullable(),
  effectiveAt: z.string().nullable(),
  freshness: z.enum(['fresh', 'fallback', 'stale', 'error']),
  refreshSupported: z.boolean(),
  parserVersion: z.string(),
  lastError: z.string().nullable().optional(),
  syntaxScope: z.string(),
  status: z.enum(['active', 'degraded', 'error']),
  totalLines: z.number(),
  supportedNetworkRules: z.number(),
  skippedRules: z.number(),
  parseErrors: z.number(),
});

const FiltersStatusResponseSchema = z.object({
  sources: z.array(FilterSourceSchema),
});

const FilterRefreshResponseSchema = z.object({
  sources: z.array(FilterSourceSchema),
  refreshedCount: z.number(),
  unchangedCount: z.number(),
  failedCount: z.number(),
  attemptedAt: z.string(),
});

export interface SettingsOperationResult<T> {
  ok: boolean;
  data: T;
  error?: string;
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isBrowserDefaultStorage(storage: StorageLike | null): boolean {
  if (typeof window === 'undefined' || !storage) return false;
  try {
    return storage === window.localStorage;
  } catch {
    return false;
  }
}

function syncBrowserSettings(settings: SettingsState): void {
  applyThemeToDocument(settings.theme);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<SettingsState>(SETTINGS_CHANGED_EVENT, { detail: settings }),
    );
  }
}

export function normalizeAllowlistHostInput(
  rawInput: string,
): { ok: true; host: string } | { ok: false; message: string } {
  const trimmed = rawInput.trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, message: 'Masukkan nama host yang ingin dikecualikan.' };
  }

  if (trimmed.includes('://') || trimmed.includes('/') || trimmed.includes('*')) {
    return {
      ok: false,
      message: 'Masukkan nama host persis tanpa protokol, jalur, atau wildcard (mis. cdn.example.com).',
    };
  }

  if (trimmed.includes('@') || /\s/.test(trimmed)) {
    return { ok: false, message: 'Nama host tidak boleh mengandung spasi atau kredensial.' };
  }

  const hostWithoutPort = trimmed.replace(/:\d+$/, '');
  if (!hostWithoutPort.includes('.') || hostWithoutPort.startsWith('.') || hostWithoutPort.endsWith('.')) {
    return { ok: false, message: 'Format nama host tidak valid.' };
  }

  if (isProhibitedHostname(hostWithoutPort)) {
    return {
      ok: false,
      message: 'Host lokal atau alamat jaringan privat tidak dapat ditambahkan ke pengecualian.',
    };
  }

  try {
    const parsed = new URL(`https://${hostWithoutPort}`);
    return { ok: true, host: parsed.hostname.toLowerCase() };
  } catch {
    return { ok: false, message: 'Nama host tidak valid.' };
  }
}

function sanitizeRetentionDays(value: unknown): HistoryRetentionDays {
  if (value === 0 || value === 7 || value === 30 || value === 90) {
    return value;
  }
  return DEFAULT_SETTINGS.privacy.historyRetentionDays;
}

function migrateAndSanitizeSettings(raw: unknown): SettingsState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const protectionRaw =
    obj.protection && typeof obj.protection === 'object'
      ? (obj.protection as Record<string, unknown>)
      : {};
  const privacyRaw =
    obj.privacy && typeof obj.privacy === 'object'
      ? (obj.privacy as Record<string, unknown>)
      : {};

  const rawHosts = Array.isArray(obj.allowlistedHosts) ? obj.allowlistedHosts : [];
  const cleanHosts: string[] = [];
  const seen = new Set<string>();
  for (const item of rawHosts) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeAllowlistHostInput(item);
    if (normalized.ok && !seen.has(normalized.host)) {
      seen.add(normalized.host);
      cleanHosts.push(normalized.host);
      if (cleanHosts.length >= MAX_ALLOWLIST_HOSTS) break;
    }
  }

  return {
    version: 1,
    theme: resolveThemeMode(obj.theme),
    protection: {
      enableFilterMatching:
        typeof protectionRaw.enableFilterMatching === 'boolean'
          ? protectionRaw.enableFilterMatching
          : DEFAULT_SETTINGS.protection.enableFilterMatching,
      warnSuspiciousLinks:
        typeof protectionRaw.warnSuspiciousLinks === 'boolean'
          ? protectionRaw.warnSuspiciousLinks
          : DEFAULT_SETTINGS.protection.warnSuspiciousLinks,
      rejectProtocolDowngrade:
        typeof protectionRaw.rejectProtocolDowngrade === 'boolean'
          ? protectionRaw.rejectProtocolDowngrade
          : DEFAULT_SETTINGS.protection.rejectProtocolDowngrade,
      bypassExternalLinks:
        typeof protectionRaw.bypassExternalLinks === 'boolean'
          ? protectionRaw.bypassExternalLinks
          : DEFAULT_SETTINGS.protection.bypassExternalLinks,
    },
    privacy: {
      saveLocalHistory:
        typeof privacyRaw.saveLocalHistory === 'boolean'
          ? privacyRaw.saveLocalHistory
          : DEFAULT_SETTINGS.privacy.saveLocalHistory,
      historyRetentionDays: sanitizeRetentionDays(privacyRaw.historyRetentionDays),
    },
    allowlistedHosts: cleanHosts,
  };
}

export function loadSettings(
  storage: StorageLike | null = getDefaultStorage(),
): SettingsOperationResult<SettingsState> {
  if (!storage) {
    return { ok: true, data: DEFAULT_SETTINGS };
  }

  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ok: true, data: DEFAULT_SETTINGS };
    }

    const parsed: unknown = JSON.parse(raw);
    const sanitized = migrateAndSanitizeSettings(parsed);
    if (!sanitized) {
      return {
        ok: false,
        data: DEFAULT_SETTINGS,
        error: 'Pengaturan lokal rusak dan dikembalikan ke bawaan.',
      };
    }

    return { ok: true, data: sanitized };
  } catch {
    return {
      ok: false,
      data: DEFAULT_SETTINGS,
      error: 'Gagal membaca pengaturan lokal.',
    };
  }
}

export function saveSettings(
  next: SettingsState,
  storage: StorageLike | null = getDefaultStorage(),
): SettingsOperationResult<SettingsState> {
  const sanitized = migrateAndSanitizeSettings(next) ?? DEFAULT_SETTINGS;

  if (!storage) {
    return { ok: true, data: sanitized };
  }

  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
    if (isBrowserDefaultStorage(storage)) {
      syncBrowserSettings(sanitized);
    }
    return { ok: true, data: sanitized };
  } catch {
    return {
      ok: false,
      data: sanitized,
      error: 'Penyimpanan lokal penuh. Perubahan pengaturan tidak dapat disimpan.',
    };
  }
}

export function resetSettings(
  storage: StorageLike | null = getDefaultStorage(),
): SettingsOperationResult<SettingsState> {
  if (!storage) {
    return { ok: true, data: DEFAULT_SETTINGS };
  }

  try {
    storage.removeItem(SETTINGS_STORAGE_KEY);
    if (isBrowserDefaultStorage(storage)) {
      syncBrowserSettings(DEFAULT_SETTINGS);
    }
    return { ok: true, data: DEFAULT_SETTINGS };
  } catch {
    return {
      ok: false,
      data: DEFAULT_SETTINGS,
      error: 'Gagal mereset pengaturan lokal.',
    };
  }
}

export async function fetchFilterSourcesStatus(
  signal?: AbortSignal,
): Promise<{ ok: true; sources: FilterSourceStatus[] } | { ok: false; message: string }> {
  try {
    const response = await fetch('/api/filters/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        message: 'Status daftar filter server tidak dapat dimuat saat ini.',
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        message: 'Format respons status daftar filter tidak dapat dibaca.',
      };
    }

    const parsed = FiltersStatusResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        message: 'Format respons status daftar filter tidak valid.',
      };
    }

    return { ok: true, sources: parsed.data.sources };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, message: 'Pembaruan status daftar filter dibatalkan.' };
    }
    return {
      ok: false,
      message: 'Tidak dapat terhubung ke layanan daftar filter server.',
    };
  }
}

export async function refreshFilterSources(
  signal?: AbortSignal,
): Promise<
  | { ok: true; data: FilterRefreshResponse }
  | { ok: false; message: string }
> {
  try {
    const response = await fetch('/api/filters/refresh', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (response.status === 429) {
      return {
        ok: false,
        message: 'Terlalu sering memperbarui daftar filter. Tunggu sekitar satu menit sebelum mencoba lagi.',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        message: 'Gagal memicu pembaruan daftar filter di server.',
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        message: 'Respons pembaruan daftar filter tidak valid.',
      };
    }

    const parsed = FilterRefreshResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        message: 'Format data pembaruan daftar filter tidak sesuai skema.',
      };
    }

    return { ok: true, data: parsed.data };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, message: 'Pembaruan daftar filter dibatalkan.' };
    }
    return {
      ok: false,
      message: 'Tidak dapat terhubung ke server untuk memperbarui daftar filter.',
    };
  }
}
