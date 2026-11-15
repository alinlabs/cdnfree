import { useId } from 'react';
import {
  Activity,
  FileCode2,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Images,
  Layers,
  LayoutGrid,
  Link2,
  Music,
  Palette,
  RotateCcw,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { Modal } from '../../components/modal';
import { SettingSwitch } from '../../components/setting-switch';
import { ASSET_KIND_OPTIONS } from '../hasil-pencarian/aset/asset-filters';
import {
  applyAssetKindChange,
  applyLinkModeChange,
  DEFAULT_SEARCH_CONFIG,
  getEnabledTargetModes,
  hasCustomSearchConfig,
  toggleTargetMode,
  type ConfigAssetKind,
  type SearchConfigState,
  type SearchTargetMode,
} from '../../utils/search-config';

interface SearchConfigModalProps {
  open: boolean;
  config: SearchConfigState;
  savedSingleTargetModes?: readonly SearchTargetMode[];
  onChange: (nextConfig: SearchConfigState) => void;
  onReset?: () => void;
  onClose: () => void;
}

const TARGET_OPTIONS: Array<{
  value: SearchTargetMode;
  label: string;
  icon: LucideIcon;
}> = [
  {
    value: 'web',
    label: 'Tampilkan Web',
    icon: Globe,
  },
  {
    value: 'detail',
    label: 'Cari Detail Data Web',
    icon: Activity,
  },
  {
    value: 'aset',
    label: 'Aset Saja',
    icon: Images,
  },
];

const CONFIG_KIND_OPTIONS = ASSET_KIND_OPTIONS.filter(
  (opt) => opt.value !== 'other',
);

const KIND_ICON_MAP: Record<Exclude<ConfigAssetKind, 'other'>, LucideIcon> = {
  all: LayoutGrid,
  image: ImageIcon,
  video: Film,
  audio: Music,
  script: FileCode2,
  stylesheet: Palette,
  font: Type,
  document: FileText,
};

export function SearchConfigModal({
  open,
  config,
  savedSingleTargetModes,
  onChange,
  onReset,
  onClose,
}: SearchConfigModalProps) {
  const linkModeHeadingId = useId();
  const targetModeHeadingId = useId();
  const assetKindHeadingId = useId();
  const switchBaseId = useId();

  const isBulk = config.linkMode === 'bulk';
  const enabledTargets = getEnabledTargetModes(config);
  const showAssetKindSection = isBulk || enabledTargets.includes('aset');
  const isCustom = hasCustomSearchConfig(config);

  const handleSelectLinkMode = (nextMode: 'single' | 'bulk') => {
    const next = applyLinkModeChange(config, nextMode, savedSingleTargetModes);
    onChange({
      ...next,
      assetFormats: [],
      assetKeyword: '',
    });
  };

  const handleToggleTargetMode = (target: SearchTargetMode) => {
    const next = toggleTargetMode(config, target);
    onChange({
      ...next,
      assetFormats: [],
      assetKeyword: '',
    });
  };

  const handleSelectAssetKind = (nextKind: ConfigAssetKind) => {
    const next = applyAssetKindChange(config, nextKind);
    onChange({
      ...next,
      assetFormats: [],
      assetKeyword: '',
    });
  };

  const handleReset = () => {
    if (onReset) {
      onReset();
    } else {
      onChange(DEFAULT_SEARCH_CONFIG);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      bounds="workspace"
      title="Konfigurasi Pencarian"
      hideDividers
      headerActions={
        <button
          type="button"
          disabled={!isCustom}
          onClick={handleReset}
          aria-label="Reset konfigurasi pencarian"
          title={
            isCustom
              ? 'Reset ke pengaturan awal'
              : 'Sudah menggunakan pengaturan awal'
          }
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={17} aria-hidden="true" />
        </button>
      }
    >
      <div className="space-y-5">
        <section aria-labelledby={linkModeHeadingId} className="space-y-2.5">
          <h3
            id={linkModeHeadingId}
            className="text-xs font-semibold text-[var(--color-text-muted)]"
          >
            Mode tautan
          </h3>

          <div
            role="radiogroup"
            aria-labelledby={linkModeHeadingId}
            className="grid grid-cols-2 gap-2.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={config.linkMode === 'single'}
              onClick={() => handleSelectLinkMode('single')}
              className={`flex min-h-[44px] items-center gap-2.5 rounded-[var(--radius-md)] border px-3.5 py-2.5 text-left text-sm transition-colors duration-150 ${
                config.linkMode === 'single'
                  ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-amber-strong)] ring-1 ring-[var(--color-amber)]/35'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
              }`}
            >
              <Link2
                size={16}
                aria-hidden="true"
                className={`shrink-0 ${
                  config.linkMode === 'single'
                    ? 'text-[var(--color-amber-strong)]'
                    : 'text-[var(--color-text-soft)]'
                }`}
              />
              <span>Single link</span>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={config.linkMode === 'bulk'}
              onClick={() => handleSelectLinkMode('bulk')}
              className={`flex min-h-[44px] items-center gap-2.5 rounded-[var(--radius-md)] border px-3.5 py-2.5 text-left text-sm transition-colors duration-150 ${
                config.linkMode === 'bulk'
                  ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-amber-strong)] ring-1 ring-[var(--color-amber)]/35'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
              }`}
            >
              <Layers
                size={16}
                aria-hidden="true"
                className={`shrink-0 ${
                  config.linkMode === 'bulk'
                    ? 'text-[var(--color-amber-strong)]'
                    : 'text-[var(--color-text-soft)]'
                }`}
              />
              <span>Bulk link</span>
            </button>
          </div>
        </section>

        {!isBulk ? (
          <section
            aria-labelledby={targetModeHeadingId}
            className="space-y-2.5"
          >
            <h3
              id={targetModeHeadingId}
              className="text-xs font-semibold text-[var(--color-text-muted)]"
            >
              Tujuan hasil
            </h3>

            <div className="space-y-2">
              {TARGET_OPTIONS.map((option) => {
                const selected = enabledTargets.includes(option.value);
                const Icon = option.icon;
                const switchId = `${switchBaseId}-${option.value}`;
                const labelId = `${switchId}-label`;

                return (
                  <div
                    key={option.value}
                    className={`flex min-h-[46px] items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3.5 py-2 transition-colors duration-150 ${
                      selected
                        ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] ring-1 ring-[var(--color-amber)]/35'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                    }`}
                  >
                    <label
                      id={labelId}
                      htmlFor={switchId}
                      className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm ${
                        selected
                          ? 'font-semibold text-[var(--color-amber-strong)]'
                          : 'font-medium text-[var(--color-text-muted)]'
                      }`}
                    >
                      <Icon
                        size={16}
                        aria-hidden="true"
                        className={`shrink-0 ${
                          selected
                            ? 'text-[var(--color-amber-strong)]'
                            : 'text-[var(--color-text-soft)]'
                        }`}
                      />
                      <span className="truncate">{option.label}</span>
                    </label>

                    <SettingSwitch
                      id={switchId}
                      checked={selected}
                      onChange={() => handleToggleTargetMode(option.value)}
                      labelledBy={labelId}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {showAssetKindSection ? (
          <section
            aria-labelledby={assetKindHeadingId}
            className="space-y-2.5"
          >
            <h3
              id={assetKindHeadingId}
              className="text-xs font-semibold text-[var(--color-text-muted)]"
            >
              Kategori aset
            </h3>

            <div
              role="radiogroup"
              aria-labelledby={assetKindHeadingId}
              className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
            >
              {CONFIG_KIND_OPTIONS.map((opt) => {
                const active = config.assetKind === opt.value;
                const Icon =
                  KIND_ICON_MAP[opt.value as Exclude<ConfigAssetKind, 'other'>] ??
                  LayoutGrid;

                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => handleSelectAssetKind(opt.value)}
                    className={`flex min-h-[44px] items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-[13px] transition-colors duration-150 ${
                      active
                        ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-amber-strong)] ring-1 ring-[var(--color-amber)]/35'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    <Icon
                      size={15}
                      aria-hidden="true"
                      className={`shrink-0 ${
                        active
                          ? 'text-[var(--color-amber-strong)]'
                          : 'text-[var(--color-text-soft)]'
                      }`}
                    />
                    <span className="whitespace-nowrap">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
