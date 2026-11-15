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
import { saveCachedInspection } from '../../services/inspection-cache';
import { getHostnameSafe } from '../../utils/inspection-details';
import {
  AUTO_BULK_URL_THRESHOLD,
  DEFAULT_SEARCH_CONFIG,
  getEnabledTargetModes,
  loadSearchConfig,
  parseBulkUrlsInput,
  resetSearchConfig,
  resolveAutoBulkForUrlInput,
  resolveSingleLinkSubmitFromBulk,
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
  const savedSingleTargetModesRef = useRef<SearchTargetMode[]>(
    initialPersisted.savedSingleTargetModes ?? [
      initialPersisted.savedSingleTargetMode,
    ],
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
      savedSingleTargetModes: savedSingleTargetModesRef.current,
      suppressAutoBulk: suppressAutoBulkRef.current,
    });

    savedSingleTargetModeRef.current = resolution.savedSingleTargetMode;
    savedSingleTargetModesRef.current = resolution.savedSingleTargetModes ?? [
      resolution.savedSingleTargetMode,
    ];
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
        const nextModes = getEnabledTargetModes(nextConfig);
        savedSingleTargetModeRef.current = nextModes[0];
        savedSingleTargetModesRef.current = nextModes;
        suppressAutoBulkRef.current = count >= AUTO_BULK_URL_THRESHOLD;
      } else {
        suppressAutoBulkRef.current = false;
      }
    } else if (nextConfig.linkMode === 'single') {
      const nextModes = getEnabledTargetModes(nextConfig);
      savedSingleTargetModeRef.current = nextModes[0];
      savedSingleTargetModesRef.current = nextModes;
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
      savedSingleTargetModes: savedSingleTargetModesRef.current,
    });
    if (bulkError) setBulkError(null);
    if (error) clearError();
  };

  const handleConfigReset = () => {
    const count = extractUrlsFromInput(urlInput).validUrls.length;
    resetSearchConfig();
    setLinkModeOrigin('default');
    savedSingleTargetModeRef.current = DEFAULT_SEARCH_CONFIG.targetMode;
    savedSingleTargetModesRef.current = [DEFAULT_SEARCH_CONFIG.targetMode];
    suppressAutoBulkRef.current = count >= AUTO_BULK_URL_THRESHOLD;
    setConfig(DEFAULT_SEARCH_CONFIG);
    if (bulkError) setBulkError(null);
    if (error) clearError();
  };

  const handleSubmit = async () => {
    let activeConfig = config;
    let submitTarget = urlInput;

    if (activeConfig.linkMode === 'bulk') {
      const parsed = parseBulkUrlsInput(urlInput);
      if (parsed.validUrls.length === 0) {
        setBulkError(
          parsed.invalidEntries[0]?.message ??
            'Tidak ditemukan URL situs yang valid untuk pencarian bulk.',
        );
        return;
      }

      if (parsed.validUrls.length === 1 && parsed.invalidEntries.length === 0) {
        const nextSingleConfig = resolveSingleLinkSubmitFromBulk({
          currentConfig: activeConfig,
          savedSingleTargetMode: savedSingleTargetModeRef.current,
          savedSingleTargetModes: savedSingleTargetModesRef.current,
        });
        activeConfig = nextSingleConfig;
        submitTarget = parsed.validUrls[0];
        const nextModes = getEnabledTargetModes(nextSingleConfig);
        savedSingleTargetModeRef.current = nextModes[0];
        savedSingleTargetModesRef.current = nextModes;
        suppressAutoBulkRef.current = false;
        setLinkModeOrigin('default');
        setConfig(nextSingleConfig);
        saveSearchConfig({
          config: nextSingleConfig,
          linkModeOrigin: 'default',
          savedSingleTargetMode: nextModes[0],
          savedSingleTargetModes: nextModes,
        });
      } else {
        const session = createBulkInspectionSession(parsed.validUrls);
        void ensureBulkInspectionRunning(session.id);

        const targetPath = buildResultsRoutePath('aset', {
          bulkId: session.id,
          jenis: activeConfig.assetKind,
          fmt: activeConfig.assetFormats,
          q: activeConfig.assetKeyword.trim() || undefined,
        });
        const firstUrl = parsed.validUrls[0];
        const firstHost = getHostnameSafe(firstUrl) || firstUrl;

        addEntry({
          id: session.id,
          url: firstUrl,
          displayUrl: firstUrl,
          host: firstHost,
          title: `${parsed.validUrls.length} situs`,
          inspectedAt: session.createdAt,
          status: 'completed',
          searchMode: 'bulk',
          targetKind: 'aset',
          enabledTargets: ['aset'],
          assetCategory: activeConfig.assetKind,
          assetFormats:
            activeConfig.assetFormats.length > 0
              ? activeConfig.assetFormats
              : undefined,
          assetKeyword: activeConfig.assetKeyword.trim() || undefined,
          routePath: targetPath,
          bulkUrls: parsed.validUrls,
          totalResourceCount: 0,
        });

        navigate(targetPath);
        return;
      }
    }

    const result = await submitUrl(submitTarget);
    if (!result) return;

    void saveCachedInspection(result);

    const destinationUrl = result.finalUrl || result.submittedUrl;
    const parsedHost = getHostnameSafe(destinationUrl) || destinationUrl;

    const enabledTargets = getEnabledTargetModes(activeConfig);
    const primaryTarget = enabledTargets[0];
    const hasAssetTarget = enabledTargets.includes('aset');
    const assetFilters = hasAssetTarget
      ? {
          jenis: activeConfig.assetKind,
          fmt: activeConfig.assetFormats,
          q: activeConfig.assetKeyword.trim() || undefined,
        }
      : undefined;

    const targetPath =
      primaryTarget === 'aset'
        ? buildResultsRoutePath('aset', {
            url: destinationUrl,
            jenis: activeConfig.assetKind,
            fmt: activeConfig.assetFormats,
            q: activeConfig.assetKeyword.trim() || undefined,
          })
        : buildResultsRoutePath(primaryTarget, { url: destinationUrl });

    addEntry({
      id: result.id,
      url: destinationUrl,
      displayUrl: destinationUrl,
      host: parsedHost,
      title: result.page.title,
      inspectedAt: result.summary.inspectedAt,
      status: 'completed',
      searchMode: 'single',
      targetKind: primaryTarget,
      enabledTargets,
      assetCategory: hasAssetTarget ? activeConfig.assetKind : undefined,
      assetFormats:
        hasAssetTarget && activeConfig.assetFormats.length > 0
          ? activeConfig.assetFormats
          : undefined,
      assetKeyword:
        hasAssetTarget && activeConfig.assetKeyword.trim()
          ? activeConfig.assetKeyword.trim()
          : undefined,
      routePath: targetPath,
      totalResourceCount: result.resources.length,
    });

    navigate(targetPath, {
      state: {
        inspectionId: result.id,
        canonicalUrl: destinationUrl,
        fromWeb: enabledTargets.includes('web'),
        enabledTargets,
        assetFilters,
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
            onOpenConfig={() => setConfigModalOpen(true)}
            error={bulkError ?? error?.message ?? null}
            isLoading={isSubmitting}
          />
        </div>
      </PageContainer>

      <SearchConfigModal
        open={configModalOpen}
        config={config}
        savedSingleTargetModes={savedSingleTargetModesRef.current}
        onChange={handleConfigChange}
        onReset={handleConfigReset}
        onClose={() => setConfigModalOpen(false)}
      />
    </>
  );
}
