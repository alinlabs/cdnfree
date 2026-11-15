import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ResourceRecord } from '../types/inspection';
import { buildResilientImageCandidates } from '../utils/proxy-url';

export type ImageFallbackResource = Pick<
  ResourceRecord,
  'id' | 'url' | 'streamUrl' | 'classification' | 'source'
>;

export function useResilientImage(
  resource: ImageFallbackResource,
  inspectionId?: string,
) {
  const candidates = useMemo(
    () => buildResilientImageCandidates(resource, inspectionId),
    [
      resource.id,
      resource.url,
      resource.streamUrl,
      resource.classification,
      resource.source,
      inspectionId,
    ],
  );
  const candidatesKey = candidates.join('\n');

  const [attemptIndex, setAttemptIndex] = useState(0);

  useEffect(() => {
    setAttemptIndex(0);
  }, [candidatesKey]);

  const activeSrc =
    attemptIndex < candidates.length ? candidates[attemptIndex] : undefined;
  const hasExhausted = attemptIndex >= candidates.length || candidates.length === 0;

  const advanceFallback = useCallback(() => {
    setAttemptIndex((prev) =>
      prev < candidates.length ? prev + 1 : prev,
    );
  }, [candidates.length]);

  return {
    candidates,
    activeSrc,
    hasExhausted,
    advanceFallback,
  };
}
