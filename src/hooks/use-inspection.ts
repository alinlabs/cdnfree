import { useCallback, useEffect, useRef, useState } from 'react';
import { submitInspectionRequest } from '../services/inspection-service';
import { loadSettings } from '../services/settings-service';
import type {
  InspectionError,
  InspectionResult,
  InspectionStatus,
} from '../types/inspection';
import { parseSingleSearchInput } from '../utils/smart-url-parser';

export interface UseInspectionReturn {
  status: InspectionStatus;
  error: InspectionError | null;
  result: InspectionResult | null;
  isSubmitting: boolean;
  submitUrl: (rawInput: string) => Promise<InspectionResult | null>;
  clearError: () => void;
  cancel: () => void;
}

export function useInspection(): UseInspectionReturn {
  const [status, setStatus] = useState<InspectionStatus>('idle');
  const [error, setError] = useState<InspectionError | null>(null);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setStatus((prev) => (prev === 'error' ? 'idle' : prev));
  }, []);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    inFlightRef.current = false;
    setStatus('idle');
  }, []);

  const submitUrl = useCallback(
    async (rawInput: string): Promise<InspectionResult | null> => {
      if (inFlightRef.current) {
        return null;
      }

      const parsed = parseSingleSearchInput(rawInput);
      const normalized = parsed.outcome;
      if (!normalized.ok) {
        setStatus('error');
        setError({
          code: 'INVALID_URL',
          message: normalized.message,
        });
        return null;
      }

      inFlightRef.current = true;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setStatus('loading');
      setError(null);

      try {
        const currentSettings = loadSettings().data;
        const outcome = await submitInspectionRequest(
          {
            url: normalized.normalizedUrl,
            options: {
              includeStaticLinks: true,
              includeResources: true,
              enableFilterMatching: currentSettings.protection.enableFilterMatching,
              warnSuspiciousLinks: currentSettings.protection.warnSuspiciousLinks,
              rejectProtocolDowngrade: currentSettings.protection.rejectProtocolDowngrade,
              allowlistedHosts: currentSettings.allowlistedHosts,
            },
          },
          controller.signal,
        );

        if (!outcome.ok) {
          if (outcome.error.code === 'ABORTED') {
            setStatus('idle');
            return null;
          }
          setStatus('error');
          setError(outcome.error);
          return null;
        }

        setResult(outcome.result);
        setStatus('success');
        return outcome.result;
      } finally {
        inFlightRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [],
  );

  return {
    status,
    error,
    result,
    isSubmitting: status === 'loading',
    submitUrl,
    clearError,
    cancel,
  };
}
