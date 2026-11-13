import { useCallback, useEffect, useRef, useState } from 'react';

export function useCopyFeedback(resetDelayMs = 1800) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return clearPendingTimer;
  }, [clearPendingTimer]);

  const copyText = useCallback(
    async (text: string, key = 'default'): Promise<boolean> => {
      clearPendingTimer();
      try {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          setCopiedKey((prev) => (prev === key ? null : prev));
        }, resetDelayMs);
        return true;
      } catch {
        setCopiedKey(null);
        return false;
      }
    },
    [clearPendingTimer, resetDelayMs],
  );

  const resetCopyFeedback = useCallback(() => {
    clearPendingTimer();
    setCopiedKey(null);
  }, [clearPendingTimer]);

  return {
    copiedKey,
    isCopied: (key = 'default') => copiedKey === key,
    copyText,
    resetCopyFeedback,
  };
}
