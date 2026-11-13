import { useEffect, useId, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RotateCw,
  Search,
} from 'lucide-react';
import { ExternalLinkAction } from '../../../components/external-link-action';
import type { InspectionResult } from '../../../types/inspection';
import { formatCleanUrl } from '../../../utils/clean-url';
import { validateExternalNavigationUrl } from '../../../utils/safe-external-url';
import { useCopyFeedback } from './use-copy-feedback';

interface ResultsHeaderWebBarProps {
  result: InspectionResult | null;
  loading: boolean;
  isReinspecting: boolean;
  quickUrl: string;
  quickUrlError: string | null;
  errorId: string;
  onQuickUrlChange: (value: string) => void;
  onQuickSubmit: () => void;
  onReinspect: () => void;
}

export function ResultsHeaderWebBar({
  result,
  loading,
  isReinspecting,
  quickUrl,
  quickUrlError,
  errorId,
  onQuickUrlChange,
  onQuickSubmit,
  onReinspect,
}: ResultsHeaderWebBarProps) {
  const inputId = useId();
  const [inputFocused, setInputFocused] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [externalModalOpen, setExternalModalOpen] = useState(false);
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isCopied, copyText, resetCopyFeedback } = useCopyFeedback(2000);

  useEffect(() => {
    resetCopyFeedback();
    setInputFocused(false);
    setActionsVisible(false);
    setExternalModalOpen(false);
  }, [result?.id, resetCopyFeedback]);

  useEffect(() => {
    if (!actionsVisible && !inputFocused) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (externalModalOpen) return;
      if (
        searchAreaRef.current &&
        !searchAreaRef.current.contains(event.target as Node)
      ) {
        setActionsVisible(false);
        setInputFocused(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !externalModalOpen) {
        setActionsVisible(false);
        setInputFocused(false);
        inputRef.current?.blur();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionsVisible, inputFocused, externalModalOpen]);

  const warningReasons: string[] = [];
  if (result?.page.isIdn) {
    warningReasons.push('Domain tujuan menggunakan karakter internasional (IDN/punycode).');
  }
  if (result && result.summary.reviewCount > 0) {
    warningReasons.push(
      `Terdapat ${result.summary.reviewCount} temuan atau pengalihan yang perlu ditinjau.`,
    );
  }

  const externalValidation = result
    ? validateExternalNavigationUrl(result.finalUrl)
    : { safe: false };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || isReinspecting) return;
    setInputFocused(false);
    inputRef.current?.blur();
    onQuickSubmit();
  };

  const handleInputBlur = (event: FocusEvent<HTMLInputElement>) => {
    const nextFocused = event.relatedTarget as Node | null;
    if (!nextFocused || !searchAreaRef.current?.contains(nextFocused)) {
      setInputFocused(false);
    }
  };

  const activeResultUrl = result ? result.finalUrl || result.submittedUrl : '';
  const isDisplayingLoadedResult = Boolean(
    result && !inputFocused && quickUrl === activeResultUrl,
  );
  const inputDisplayValue = isDisplayingLoadedResult
    ? formatCleanUrl(activeResultUrl, { redactSensitive: true })
    : quickUrl;

  const copied = result ? isCopied(result.id) : false;
  const showActionIcons = Boolean(result && actionsVisible);

  return (
    <div
      ref={searchAreaRef}
      className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex-nowrap"
    >
      <form
        onSubmit={handleFormSubmit}
        noValidate
        className="min-w-[140px] flex-1"
      >
        <label htmlFor={inputId} className="sr-only">
          URL situs yang ingin diperiksa
        </label>
        <div className="relative w-full">
          <button
            type="button"
            onClick={onReinspect}
            disabled={!result || loading || isReinspecting}
            aria-busy={isReinspecting}
            aria-label={isReinspecting ? 'Memeriksa ulang...' : 'Periksa ulang'}
            title={isReinspecting ? 'Memeriksa ulang...' : 'Periksa ulang'}
            className="absolute top-1/2 left-1 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-soft)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCw
              size={15}
              aria-hidden="true"
              className={isReinspecting ? 'animate-spin text-[var(--color-amber)]' : ''}
            />
          </button>

          <input
            ref={inputRef}
            id={inputId}
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={inputDisplayValue}
            onFocus={() => {
              setInputFocused(true);
              if (result) setActionsVisible(true);
            }}
            onClick={() => {
              setInputFocused(true);
              if (result) setActionsVisible(true);
            }}
            onBlur={handleInputBlur}
            onChange={(event) => onQuickUrlChange(event.target.value)}
            placeholder="Tempel atau masukkan URL situs..."
            aria-invalid={quickUrlError ? 'true' : 'false'}
            aria-describedby={quickUrlError ? errorId : undefined}
            className={`h-9 w-full rounded-[var(--radius-sm)] border bg-[var(--color-surface)] pr-9 pl-9 text-xs text-left text-[var(--color-text)] tabular-nums placeholder:text-[var(--color-text-soft)] outline-none focus:outline-none focus-visible:outline-none transition-colors duration-150 sm:text-sm ${
              quickUrlError
                ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)]'
                : 'border-[var(--color-border)] focus:border-[var(--color-amber)]'
            }`}
          />

          <button
            type="submit"
            disabled={loading || isReinspecting}
            aria-busy={loading}
            aria-label="Periksa tautan"
            title="Periksa tautan"
            className="absolute top-1/2 right-1 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-soft)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-amber)] focus-visible:text-[var(--color-amber)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <Loader2
                size={15}
                aria-hidden="true"
                className="animate-spin text-[var(--color-amber)]"
              />
            ) : (
              <Search size={15} aria-hidden="true" />
            )}
          </button>
        </div>
      </form>

      {showActionIcons && result ? (
        <div
          role="toolbar"
          aria-label="Aksi tautan"
          className="flex shrink-0 items-center gap-1"
        >
          <button
            type="button"
            onClick={() => {
              void copyText(result.finalUrl, result.id);
            }}
            aria-label={copied ? 'URL tersalin' : 'Salin URL'}
            title={copied ? 'Tersalin' : 'Salin URL'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          >
            {copied ? (
              <Check size={15} aria-hidden="true" className="text-[var(--color-success)]" />
            ) : (
              <Copy size={15} aria-hidden="true" />
            )}
          </button>

          {externalValidation.safe ? (
            <button
              type="button"
              onClick={() => setExternalModalOpen(true)}
              aria-label="Buka situs"
              title="Buka situs"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            >
              <ExternalLink size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <ExternalLinkAction
          url={result.finalUrl}
          label="Buka situs"
          warningText={
            warningReasons.length > 0 ? warningReasons.join(' ') : undefined
          }
          open={externalModalOpen}
          onOpenChange={setExternalModalOpen}
          hideTrigger
        />
      ) : null}
    </div>
  );
}
