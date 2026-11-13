import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '../../components/page-container';
import { TopProgressLine } from '../../components/top-progress-line';
import { useHistory } from '../../hooks/use-history';
import { useInspection } from '../../hooks/use-inspection';
import {
  createBulkInspectionSession,
  ensureBulkInspectionRunning,
} from '../../services/bulk-inspection-store';
import {
  applyLinkModeChange,
  AUTO_BULK_URL_THRESHOLD,
  DEFAULT_SEARCH_CONFIG,
  loadSearchConfig,
  parseBulkUrlsInput,
  resetSearchConfig,
  resolveAutoBulkForUrlInput,
  saveSearchConfig,
  type LinkModeOrigin,
  type SearchConfigState,
  type SearchTargetMode,
} from '../../utils/search-config';
import { extractUrlsFromInput } from '../../utils/smart-url-parser';
import { buildResultsRoutePath } from '../hasil-pencarian/shared/results-navigation';
import { HeroSection } from './hero-section';
import { SearchConfigModal } from './search-config-modal';

export function BerandaPage() {
  const navigate = useNavigate();
  const [initialPersisted] = useState(() => loadSearchConfig());
  const [urlInput, setUrlInput] = useState('');
  const [config, setConfig] = useState<SearchConfigState>(initialPersisted.config);
  const [linkModeOrigin, setLinkModeOrigin] = useState<LinkModeOrigin>(
    initialPersisted.linkModeOrigin,
  );
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const savedSingleTargetModeRef = useRef<SearchTargetMode>(
    initialPersisted.savedSingleTargetMode,
  );
  const suppressAutoBulkRef = useRef(false);
  const { addEntry } = useHistory();
  const { error, isSubmitting, submitUrl, clearError } = useInspection();

  const handleUrlChange = (nextValue: string) => {
    setUrlInput(nextValue);
    if (error) clearError();
    if (bulkError) setBulkError(null);

    const resolution = resolveAutoBulkForUrlInput({
      rawUrlInput: nextValue,
      currentConfig: config,
      origin: linkModeOrigin,
      savedSingleTargetMode: savedSingleTargetModeRef.current,
      suppressAutoBulk: suppressAutoBulkRef.current,
    });

    savedSingleTargetModeRef.current = resolution.savedSingleTargetMode;
    suppressAutoBulkRef.current = resolution.suppressAutoBulk;

    if (resolution.origin !== linkModeOrigin) {
      setLinkModeOrigin(resolution.origin);
    }
    if (resolution.config !== config) {
      setConfig(resolution.config);
    }
  };

  const handleConfigChange = (nextConfig: SearchConfigState) => {
    const count = extractUrlsFromInput(urlInput).validUrls.length;
    let nextOrigin: LinkModeOrigin = linkModeOrigin;

    if (nextConfig.linkMode !== config.linkMode) {
      nextOrigin = 'manual';
      if (nextConfig.linkMode === 'single') {
        savedSingleTargetModeRef.current = nextConfig.targetMode;
        suppressAutoBulkRef.current = count >= AUTO_BULK_URL_THRESHOLD;
      } else {
        suppressAutoBulkRef.current = false;
      }
    } else if (nextConfig.linkMode === 'single') {
      savedSingleTargetModeRef.current = nextConfig.targetMode;
    } else if (nextConfig.linkMode === 'bulk') {
      nextOrigin = 'manual';
    }

    if (nextOrigin !== linkModeOrigin) {
      setLinkModeOrigin(nextOrigin);
    }
    setConfig(nextConfig);
    saveSearchConfig({
      config: nextConfig,
      linkModeOrigin: nextOrigin,
      savedSingleTargetMode: savedSingleTargetModeRef.current,
    });
    if (bulkError) setBulkError(null);
    if (error) clearError();
  };

  const handleConfigReset = () => {
    const count = extractUrlsFromInput(urlInput).validUrls.length;
    resetSearchConfig();
    setLinkModeOrigin('default');
    savedSingleTargetModeRef.current = DEFAULT_SEARCH_CONFIG.targetMode;
    suppressAutoBulkRef.current = count >= AUTO_BULK_URL_THRESHOLD;
    setConfig(DEFAULT_SEARCH_CONFIG);
    if (bulkError) setBulkError(null);
    if (error) clearError();
  };

  const handleSubmit = async () => {
    if (config.linkMode === 'bulk') {
      const parsed = parseBulkUrlsInput(urlInput);
      if (parsed.validUrls.length === 0) {
        setBulkError(
          parsed.invalidEntries[0]?.message ??
            'Tidak ditemukan URL situs yang valid untuk pencarian bulk.',
        );
        return;
      }

      const session = createBulkInspectionSession(parsed.validUrls);
      void ensureBulkInspectionRunning(session.id);

      navigate(
        buildResultsRoutePath('aset', {
          bulkId: session.id,
          jenis: config.assetKind,
          fmt: config.assetFormats,
          q: config.assetKeyword.trim() || undefined,
        }),
      );
      return;
    }

    const result = await submitUrl(urlInput);
    if (!result) return;

    const destinationUrl = result.finalUrl || result.submittedUrl;
    const parsedHost = (() => {
      try {
        return new URL(destinationUrl).hostname;
      } catch {
        return destinationUrl;
      }
    })();

    addEntry({
      id: result.id,
      url: destinationUrl,
      displayUrl: destinationUrl,
      host: parsedHost,
      title: result.page.title,
      inspectedAt: result.summary.inspectedAt,
      status: 'completed',
    });

    const targetPath =
      config.targetMode === 'aset'
        ? buildResultsRoutePath('aset', {
            url: destinationUrl,
            jenis: config.assetKind,
            fmt: config.assetFormats,
            q: config.assetKeyword.trim() || undefined,
          })
        : buildResultsRoutePath(config.targetMode, { url: destinationUrl });

    navigate(targetPath, {
      state: {
        inspectionId: result.id,
        canonicalUrl: destinationUrl,
        fromWeb: config.targetMode === 'web',
      },
    });
  };

  return (
    <>
      <TopProgressLine
        visible={isSubmitting}
        placement="viewport-top"
        label="Memeriksa tautan..."
      />
      <PageContainer className="flex flex-1 flex-col items-center justify-center py-10 sm:py-16">
        <div className="w-full max-w-[780px]">
          <HeroSection
            urlValue={urlInput}
            onUrlChange={handleUrlChange}
            onSubmit={handleSubmit}
            config={config}
            isAutoBulk={linkModeOrigin === 'auto'}
            onOpenConfig={() => setConfigModalOpen(true)}
            onSwitchToBulk={() =>
              handleConfigChange(applyLinkModeChange(config, 'bulk'))
            }
            error={bulkError ?? error?.message ?? null}
            isLoading={isSubmitting}
          />
        </div>
      </PageContainer>

      <SearchConfigModal
        open={configModalOpen}
        config={config}
        onChange={handleConfigChange}
        onReset={handleConfigReset}
        onClose={() => setConfigModalOpen(false)}
      />
    </>
  );
}
