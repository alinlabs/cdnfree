import { ExternalLinkAction } from '../../../components/external-link-action';
import { Modal } from '../../../components/modal';
import { PdfViewerSurface } from '../../../components/pdf-preview';
import {
  FontPreviewSurface,
  TextPreviewSurface,
} from '../../../components/text-asset-modal';
import type { ResourceRecord } from '../../../types/inspection';
import {
  getAssetFilename,
  getInlineAssetPreviewKind,
} from '../../../utils/asset-explorer';
import { buildProxyAssetUrl } from '../../../utils/proxy-url';

interface ResourcePreviewModalProps {
  inspectionId: string;
  resource: ResourceRecord | null;
  resolveInspectionId?: (resource: ResourceRecord) => string;
  onClose: () => void;
}

export function ResourcePreviewModal({
  inspectionId,
  resource,
  resolveInspectionId,
  onClose,
}: ResourcePreviewModalProps) {
  if (!resource) return null;

  const kind = getInlineAssetPreviewKind(resource);
  const assetSrc = buildProxyAssetUrl(
    resource.url,
    resolveInspectionId?.(resource) ?? inspectionId,
  );
  const filename = getAssetFilename(resource.url);

  return (
    <Modal
      open
      onClose={onClose}
      title={filename}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            Tutup
          </button>
          <ExternalLinkAction
            direct
            url={resource.url}
            label="Buka aset di tab baru"
            variant="primary"
          />
        </>
      }
    >
      {kind === 'pdf' ? (
        <PdfViewerSurface src={assetSrc} title={filename} compactHeight />
      ) : kind === 'font' ? (
        <FontPreviewSurface src={assetSrc} title={filename} />
      ) : (
        <TextPreviewSurface
          src={assetSrc}
          mimeType={resource.mimeType}
          compactHeight
        />
      )}
    </Modal>
  );
}
