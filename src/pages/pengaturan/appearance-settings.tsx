import { useId } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import type { ThemeMode } from '../../types/settings';

interface AppearanceSettingsProps {
  theme: ThemeMode;
  onUpdateTheme: (theme: ThemeMode) => void;
}

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeMode;
  label: string;
  description: string;
  previewBg: string;
  previewBorder: string;
  previewSurface: string;
  previewText: string;
}> = [
  {
    value: 'light',
    label: 'Tema terang',
    description: 'Latar putih bersih dengan kontras terang.',
    previewBg: '#ffffff',
    previewBorder: '#e9e7e2',
    previewSurface: '#f8f8f7',
    previewText: '#242424',
  },
  {
    value: 'dark',
    label: 'Tema gelap',
    description: 'Latar gelap netral yang nyaman untuk mata.',
    previewBg: '#111113',
    previewBorder: '#2e2e34',
    previewSurface: '#18181b',
    previewText: '#f3f2ef',
  },
];

export function AppearanceSettingsSection({
  theme,
  onUpdateTheme,
}: AppearanceSettingsProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3.5 border-b border-[var(--color-border)] pb-6"
    >
      <div>
        <h2
          id={headingId}
          className="text-base font-semibold text-[var(--color-text)]"
        >
          Tampilan
        </h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Pilih tema terang atau gelap untuk seluruh antarmuka CDNFREE. Perubahan diterapkan langsung dan tersimpan di perangkat ini.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {THEME_OPTIONS.map((option) => {
          const selected = theme === option.value;
          const Icon = option.value === 'dark' ? Moon : Sun;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onUpdateTheme(option.value)}
              className={`flex items-center gap-3.5 rounded-[var(--radius-md)] border p-3.5 text-left transition-colors duration-150 ${
                selected
                  ? 'border-[var(--color-amber)] bg-[var(--color-amber-soft)] ring-1 ring-[var(--color-amber)]/35'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)]'
              }`}
            >
              <span
                aria-hidden="true"
                style={{
                  backgroundColor: option.previewBg,
                  borderColor: option.previewBorder,
                }}
                className="flex h-12 w-16 shrink-0 flex-col justify-between overflow-hidden rounded-[6px] border p-1.5"
              >
                <span className="flex items-center justify-between gap-1">
                  <span
                    style={{ backgroundColor: '#ffa31a' }}
                    className="h-1.5 w-4 rounded-xs"
                  />
                  <span
                    style={{ backgroundColor: option.previewBorder }}
                    className="h-1.5 w-3 rounded-xs"
                  />
                </span>
                <span
                  style={{
                    backgroundColor: option.previewSurface,
                    borderColor: option.previewBorder,
                  }}
                  className="flex h-4 w-full items-center gap-1 rounded-[3px] border px-1"
                >
                  <span
                    style={{ backgroundColor: option.previewText }}
                    className="h-1 w-6 rounded-full opacity-75"
                  />
                </span>
              </span>

              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
                  <Icon
                    size={15}
                    aria-hidden="true"
                    className={
                      selected
                        ? 'text-[var(--color-amber-strong)]'
                        : 'text-[var(--color-text-muted)]'
                    }
                  />
                  <span>{option.label}</span>
                </span>
                <span className="block text-xs leading-snug text-[var(--color-text-muted)]">
                  {option.description}
                </span>
              </span>

              <span
                aria-hidden="true"
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  selected
                    ? 'border-[var(--color-amber)] bg-[var(--color-amber)] text-[var(--color-on-amber)]'
                    : 'border-[var(--color-border)] bg-transparent text-transparent'
                }`}
              >
                <Check size={12} strokeWidth={2.5} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
