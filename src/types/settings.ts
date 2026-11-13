export type HistoryRetentionDays = 7 | 30 | 90 | 0;
export type ThemeMode = 'light' | 'dark';

export interface ProtectionSettings {
  enableFilterMatching: boolean;
  warnSuspiciousLinks: boolean;
  rejectProtocolDowngrade: boolean;
  bypassExternalLinks: boolean;
}

export interface PrivacySettings {
  saveLocalHistory: boolean;
  historyRetentionDays: HistoryRetentionDays;
}

export interface SettingsState {
  version: 1;
  theme: ThemeMode;
  protection: ProtectionSettings;
  privacy: PrivacySettings;
  allowlistedHosts: string[];
}

export type FilterSourceFreshness = 'fresh' | 'fallback' | 'stale' | 'error';

export interface FilterSourceStatus {
  id: string;
  name: string;
  purpose: string;
  sourceUrl: string;
  attribution: string;
  license: string;
  updatedAt: string;
  fetchedAt: string | null;
  effectiveAt: string | null;
  freshness: FilterSourceFreshness;
  refreshSupported: boolean;
  parserVersion: string;
  lastError?: string | null;
  syntaxScope: string;
  status: 'active' | 'degraded' | 'error';
  totalLines: number;
  supportedNetworkRules: number;
  skippedRules: number;
  parseErrors: number;
}

export interface FilterRefreshResponse {
  sources: FilterSourceStatus[];
  refreshedCount: number;
  unchangedCount: number;
  failedCount: number;
  attemptedAt: string;
}
