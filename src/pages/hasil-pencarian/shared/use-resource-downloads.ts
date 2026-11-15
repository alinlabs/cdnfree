import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadResourceAsset } from '../../../services/download-service';
import type { ResourceRecord } from '../../../types/inspection';
import { formatBytes } from '../../../utils/format-bytes';

export interface ResourceDownloadState {
  status: 'idle' | 'downloading' | 'downloaded' | 'error';
  message?: string;
}

const IDLE_STATE: ResourceDownloadState = { status: 'idle' };

export function useResourceDownloads(
  inspectionId: string,
  resolveInspectionId?: (resource: ResourceRecord) => string,
) {
  const [states, setStates] = useState<Record<string, ResourceDownloadState>>({});
  const activeScopeRef = useRef(inspectionId);
  activeScopeRef.current = inspectionId;

  useEffect(() => {
    setStates({});
  }, [inspectionId]);

  const getDownloadState = useCallback(
    (resourceId: string): ResourceDownloadState => states[resourceId] ?? IDLE_STATE,
    [states],
  );

  const downloadResource = useCallback(
    async (resource: ResourceRecord, fallbackFilename: string) => {
      const activeScope = inspectionId;
      const targetInspectionId = resolveInspectionId
        ? resolveInspectionId(resource)
        : inspectionId;
      setStates((prev) => ({
        ...prev,
        [resource.id]: { status: 'downloading' },
      }));

      const outcome = await downloadResourceAsset(
        targetInspectionId,
        resource,
        fallbackFilename,
      );

      if (activeScopeRef.current !== activeScope) {
        return outcome;
      }

      if (outcome.ok) {
        setStates((prev) => ({
          ...prev,
          [resource.id]: {
            status: 'downloaded',
            message: `Tersimpan (${formatBytes(outcome.bytes)})`,
          },
        }));
      } else {
        setStates((prev) => ({
          ...prev,
          [resource.id]: {
            status: 'error',
            message: outcome.message,
          },
        }));
      }

      return outcome;
    },
    [inspectionId, resolveInspectionId],
  );

  return {
    getDownloadState,
    downloadResource,
  };
}
