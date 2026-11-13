import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { ExternalLinkAction } from '../../components/external-link-action';
import {
  fetchFilterSourcesStatus,
  normalizeAllowlistHostInput,
  refreshFilterSources,
} from '../../services/settings-service';
import type { FilterSourceStatus } from '../../types/settings';
import { formatTimestampId } from '../../utils/format-date';

interface FilterSettingsProps {
  allowlistedHosts: string[];
  onAddHost: (
    rawHost: string,
  ) => { ok: true; host: string } | { ok: false; message: string };
  onRemoveHost: (host: string) => void;
}

function formatFreshnessLabel(source: FilterSourceStatus): {
  label: string;
  toneClass: string;
} {
  if (source.freshness === 'fresh' && source.status === 'active') {
    return {
      label: 'Aktif · Tersinkronisasi',
      toneClass: 'text-[var(--color-success)]',
    };
  }
  if (source.freshness === 'fallback') {
    return {
      label: 'Cadangan bawaan (luring)',
      toneClass: 'text-[var(--color-text-muted)]',
    };
  }
  if (source.freshness === 'stale') {
    return {
      label:
        source.supportedNetworkRules > 0
          ? 'Kedaluwarsa · Memakai salinan terakhir'
          : 'Belum disinkronkan (cadangan bawaan aktif)',
      toneClass: 'text-[var(--color-amber-strong)]',
    };
  }
  return {
    label: 'Gagal dimuat · Memakai cadangan',
    toneClass: 'text-[var(--color-danger)]',
  };
}

export function FilterSettingsSection({
  allowlistedHosts,
  onAddHost,
  onRemoveHost,
}: FilterSettingsProps) {
  const [sources, setSources] = useState<FilterSourceStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const [hostInput, setHostInput] = useState('');
  const [hostError, setHostError] = useState<string | null>(null);
  const [pendingAddHost, setPendingAddHost] = useState<string | null>(null);
  const [pendingRemoveHost, setPendingRemoveHost] = useState<string | null>(null);
  const refreshAbortRef = useRef<AbortController | null>(null);

  const loadSources = useCallback(async (signal?: AbortSignal) => {
    setStatusLoading(true);
    setStatusError(null);
    const outcome = await fetchFilterSourcesStatus(signal);
    if (signal?.aborted) return;

    if (outcome.ok) {
      setSources(outcome.sources);
    } else {
      setStatusError(outcome.message);
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadSources(controller.signal);
    return () => controller.abort();
  }, [loadSources]);

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
    };
  }, []);

  const handleRefreshSources = async () => {
    if (refreshing || statusLoading) return;
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    setRefreshing(true);
    setStatusError(null);
    setRefreshMessage(null);

    const outcome = await refreshFilterSources(controller.signal);
    if (controller.signal.aborted) return;

    if (refreshAbortRef.current === controller) {
      refreshAbortRef.current = null;
    }
    setRefreshing(false);

    if (!outcome.ok) {
      setStatusError(outcome.message);
      return;
    }

    setSources(outcome.data.sources);
    const { refreshedCount, unchangedCount, failedCount } = outcome.data;
    setRefreshMessage(
      `Sinkronisasi selesai: ${refreshedCount} sumber diperbarui, ${unchangedCount} tidak berubah (304), ${failedCount} gagal (salinan aman terakhir dipertahankan).`,
    );
  };

  const handleHostSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeAllowlistHostInput(hostInput);
    if (!normalized.ok) {
      setHostError(normalized.message);
      return;
    }

    if (allowlistedHosts.includes(normalized.host)) {
      setHostError('Host tersebut sudah ada dalam daftar pengecualian.');
      return;
    }

    setHostError(null);
    setPendingAddHost(normalized.host);
  };

  const confirmAddHost = () => {
    if (!pendingAddHost) return;
    const outcome = onAddHost(pendingAddHost);
    if (outcome.ok) {
      setHostInput('');
      setHostError(null);
    } else {
      setHostError(outcome.message);
    }
    setPendingAddHost(null);
  };

  return (
    <section
      aria-labelledby="filter-pengecualian-heading"
      className="space-y-6 border-b border-[var(--color-border)] pb-6"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="filter-pengecualian-heading"
              className="text-base font-semibold text-[var(--color-text)]"
            >
              Filter & sumber aturan
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Status sumber daftar filter iklan/pelacak, atribusi lisensi, kesegaran data, dan sinkronisasi aman di server.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={statusLoading || refreshing}
              onClick={() => loadSources()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>Muat ulang status</span>
            </button>

            <button
              type="button"
              disabled={statusLoading || refreshing}
              onClick={handleRefreshSources}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-3 py-1.5 text-xs font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                size={13}
                aria-hidden="true"
                className={refreshing ? 'animate-spin' : ''}
              />
              <span>
                {refreshing ? 'Memperbarui...' : 'Perbarui daftar filter'}
              </span>
            </button>
          </div>
        </div>

        {refreshMessage ? (
          <p role="status" className="text-xs font-medium text-[var(--color-text-muted)]">
            {refreshMessage}
          </p>
        ) : null}

        {statusLoading ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Memeriksa status daftar filter server...
          </p>
        ) : statusError ? (
          <p role="alert" className="text-xs font-medium text-[var(--color-danger)]">
            {statusError}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {sources.map((source) => {
              const freshnessInfo = formatFreshnessLabel(source);
              return (
                <li
                  key={source.id}
                  className="flex min-w-0 flex-col justify-between space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--color-text)]">
                        {source.name}
                      </span>
                      <span className={`font-medium ${freshnessInfo.toneClass}`}>
                        {freshnessInfo.label}
                      </span>
                    </div>

                    <p className="text-[var(--color-text)]">
                      Tujuan: {source.purpose}
                    </p>

                    <p className="text-[var(--color-text-muted)]">
                      Atribusi: {source.attribution} · Lisensi: {source.license}
                    </p>

                    <div className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums text-[var(--color-text-soft)]">
                      <span>Diperbarui sumber: {source.updatedAt}</span>
                      <span>
                        Terakhir diambil:{' '}
                        {source.fetchedAt ? formatTimestampId(source.fetchedAt) : 'Belum pernah'}
                      </span>
                      <span>Aturan jaringan aktif: {source.supportedNetworkRules}</span>
                      <span>Dilewati: {source.skippedRules}</span>
                      <span>Error parse: {source.parseErrors}</span>
                      <span>Parser: v{source.parserVersion}</span>
                    </div>

                    {source.lastError ? (
                      <p role="status" className="font-medium text-[var(--color-danger)]">
                        Kendala terakhir: {source.lastError}
                      </p>
                    ) : null}

                    <p className="leading-relaxed text-[var(--color-text-muted)]">
                      Cakupan: {source.syntaxScope}
                    </p>
                  </div>

                  <div>
                    <ExternalLinkAction
                      url={source.sourceUrl}
                      label="Lihat sumber daftar filter"
                      variant="text"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs leading-relaxed text-[var(--color-text-soft)]">
          Catatan keterbatasan sumber: identifikasi host CDN dan pemendek tautan menggunakan peta statis bawaan tanpa panggilan API pihak ketiga. Feed reputasi malware jarak jauh tidak diaktifkan secara bawaan tanpa kunci/lisensi terverifikasi; kecocokan daftar filter ditampilkan sebagai indikasi bukti, bukan vonis malware mutlak.
        </p>
      </div>

      <div className="space-y-3 pt-2">
        <div className="max-w-[72ch]">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Pengecualian host (Allowlist)
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
            Pengecualian berlaku tepat untuk satu nama host (exact host, bukan wildcard) dan hanya menonaktifkan penandaan daftar filter untuk host tersebut. Validasi keamanan SSRF tetap selalu berlaku.
          </p>
        </div>

        <form onSubmit={handleHostSubmit} noValidate className="flex max-w-[640px] flex-col gap-2 sm:flex-row">
          <label htmlFor="allowlist-host-input" className="sr-only">
            Nama host yang dikecualikan
          </label>
          <input
            id="allowlist-host-input"
            type="text"
            value={hostInput}
            onChange={(event) => {
              setHostInput(event.target.value);
              if (hostError) setHostError(null);
            }}
            placeholder="Contoh: cdn.example.com"
            className="h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-soft)]"
          />
          <button
            type="submit"
            className="min-h-[40px] shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
          >
            Tambah pengecualian
          </button>
        </form>

        {hostError ? (
          <p role="alert" className="text-xs font-medium text-[var(--color-danger)]">
            {hostError}
          </p>
        ) : null}

        {allowlistedHosts.length === 0 ? (
          <p className="text-xs text-[var(--color-text-soft)]">
            Belum ada host yang dikecualikan.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {allowlistedHosts.map((host) => (
              <li
                key={host}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <span className="break-all font-medium text-[var(--color-text)]">
                  {host}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingRemoveHost(host)}
                  aria-label={`Hapus pengecualian ${host}`}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-danger)]"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingAddHost)}
        onClose={() => setPendingAddHost(null)}
        onConfirm={confirmAddHost}
        title="Tambahkan host ke pengecualian?"
        description={
          pendingAddHost
            ? `Host "${pendingAddHost}" akan dikecualikan dari penandaan daftar filter pada pemeriksaan berikutnya. Pemeriksaan skema dan kebijakan IP privat tetap berjalan.`
            : ''
        }
        confirmLabel="Tambahkan host"
        cancelLabel="Batal"
      />

      <ConfirmDialog
        open={Boolean(pendingRemoveHost)}
        onClose={() => setPendingRemoveHost(null)}
        onConfirm={() => {
          if (pendingRemoveHost) onRemoveHost(pendingRemoveHost);
          setPendingRemoveHost(null);
        }}
        title="Hapus pengecualian host?"
        description={
          pendingRemoveHost
            ? `Host "${pendingRemoveHost}" akan kembali diperiksa menggunakan aturan daftar filter standar.`
            : ''
        }
        confirmLabel="Hapus pengecualian"
        cancelLabel="Batal"
        destructive
      />
    </section>
  );
}
