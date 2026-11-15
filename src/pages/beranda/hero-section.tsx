import { UrlInput } from '../../components/url-input';
import {
  hasCustomSearchConfig,
  type SearchConfigState,
} from '../../utils/search-config';
import { AnimatedHeroTitle } from './animated-hero-title';

interface HeroSectionProps {
  urlValue: string;
  onUrlChange: (value: string) => void;
  onSubmit: () => void;
  config: SearchConfigState;
  onOpenConfig: () => void;
  error?: string | null;
  isLoading?: boolean;
}

export function HeroSection({
  urlValue,
  onUrlChange,
  onSubmit,
  config,
  onOpenConfig,
  error = null,
  isLoading = false,
}: HeroSectionProps) {
  const isBulk = config.linkMode === 'bulk';
  const isCustomConfig = hasCustomSearchConfig(config);

  return (
    <section
      aria-labelledby="beranda-heading"
      className="flex flex-col items-center space-y-5 text-center"
    >
      <div className="w-full">
        <AnimatedHeroTitle />
      </div>

      <div className="w-full max-w-[780px] space-y-3 pt-0.5">
        <UrlInput
          value={urlValue}
          onChange={onUrlChange}
          onSubmit={onSubmit}
          error={error}
          isLoading={isLoading}
          multiline={isBulk}
          allowAutoMultilinePaste
          label={
            isBulk
              ? 'Daftar URL situs untuk pencarian bulk aset'
              : 'URL situs yang ingin diperiksa'
          }
          placeholder="Tuliskan URL Disini"
          submitLabel={
            isBulk ? 'Mulai cari aset secara serentak' : 'Periksa tautan'
          }
          loadingLabel={
            isBulk ? 'Memeriksa tautan secara serentak...' : 'Memeriksa tautan...'
          }
        />

        <div className="flex justify-center">
          <button
            type="button"
            onClick={onOpenConfig}
            aria-label={
              isCustomConfig
                ? 'Atur Konfigurasi Pencarian (pengaturan khusus aktif)'
                : 'Atur Konfigurasi Pencarian'
            }
            className="text-xs font-medium text-[var(--color-amber)] underline-offset-4 transition-opacity duration-150 hover:underline hover:opacity-85 sm:text-sm"
          >
            Atur Konfigurasi Pencarian
          </button>
        </div>
      </div>
    </section>
  );
}
