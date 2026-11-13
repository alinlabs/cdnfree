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
  Type,
  type LucideIcon,
} from 'lucide-react';
import { Modal } from '../../components/modal';
import { ASSET_KIND_OPTIONS } from '../hasil-pencarian/aset/asset-filters';
import {
  applyAssetKindChange,
  applyLinkModeChange,
  applyTargetModeChange,
  DEFAULT_SEARCH_CONFIG,
  hasCustomSearchConfig,
  type ConfigAssetKind,
  type SearchConfigState,
  type SearchTargetMode,
} from '../../utils/search-config';

interface SearchConfigModalProps {
  open: boolean;
  config: SearchConfigState;
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
  onChange,
  onReset,
  onClose,
}: SearchConfigModalProps) {
  const linkModeHeadingId = useId();
  const targetModeHeadingId = useId();
  const assetKindHeadingId = useId();

  const isBulk = config.linkMode === 'bulk';
  const isCustom = hasCustomSearchConfig(config);

  const handleSelectLinkMode = (nextMode: 'single' | 'bulk') => {
    const next = applyLinkModeChange(config, nextMode);
    onChange({
      ...next,
      assetFormats: [],
      assetKeyword: '',
    });
  };

  const handleSelectTargetMode = (nextTarget: SearchTargetMode) => {
    const next = applyTargetModeChange(config, nextTarget);
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
      footer={
        isCustom ? (
          <button
            type="button"
            onClick={handleReset}
            className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          >
            Reset default
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4">
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
                  ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-text)] ring-1 ring-[var(--color-amber)]/35'
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
                  ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-text)] ring-1 ring-[var(--color-amber)]/35'
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
            className="space-y-2.5 border-t border-[var(--color-border)] pt-4"
          >
            <h3
              id={targetModeHeadingId}
              className="text-xs font-semibold text-[var(--color-text-muted)]"
            >
              Tujuan hasil
            </h3>

            <div
              role="radiogroup"
              aria-labelledby={targetModeHeadingId}
              className="grid grid-cols-1 gap-2.5 md:grid-cols-3"
            >
              {TARGET_OPTIONS.map((option) => {
                const selected = config.targetMode === option.value;
                const Icon = option.icon;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleSelectTargetMode(option.value)}
                    className={`flex min-h-[44px] items-center gap-2.5 rounded-[var(--radius-md)] border px-3.5 py-2.5 text-left text-sm transition-colors duration-150 ${
                      selected
                        ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] font-semibold text-[var(--color-text)] ring-1 ring-[var(--color-amber)]/35'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]'
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
                    <span className="whitespace-nowrap">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {isBulk || config.targetMode === 'aset' ? (
          <section
            aria-labelledby={assetKindHeadingId}
            className="space-y-2.5 border-t border-[var(--color-border)] pt-4"
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
