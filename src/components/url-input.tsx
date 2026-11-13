import {
  useId,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Loader2, Search } from 'lucide-react';
import { AUTO_BULK_URL_THRESHOLD } from '../utils/search-config';
import { extractUrlsFromInput } from '../utils/smart-url-parser';

interface UrlInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  error?: string | null;
  isLoading?: boolean;
  compact?: boolean;
  multiline?: boolean;
  allowAutoMultilinePaste?: boolean;
  rows?: number;
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  loadingLabel?: string;
}

export function UrlInput({
  value,
  onChange,
  onSubmit,
  error = null,
  isLoading = false,
  compact = false,
  multiline = false,
  allowAutoMultilinePaste = false,
  rows = 4,
  label = 'URL situs yang ingin diperiksa',
  placeholder = 'Tempel atau masukkan URL situs...',
  submitLabel = 'Periksa tautan',
  loadingLabel = 'Memeriksa tautan...',
}: UrlInputProps) {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMultilineRef = useRef(multiline);
  const pendingSelectionRef = useRef<{
    start: number;
    end: number;
    wasFocused: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const prevMultiline = prevMultilineRef.current;
    prevMultilineRef.current = multiline;

    const pending = pendingSelectionRef.current;
    pendingSelectionRef.current = null;

    if (prevMultiline === multiline || !pending?.wasFocused) {
      return;
    }

    const targetEl = multiline ? textareaRef.current : inputRef.current;
    if (!targetEl) return;

    targetEl.focus();
    try {
      targetEl.setSelectionRange(pending.start, pending.end);
    } catch {
      // Ignore selection restoration errors on unsupported input states
    }
  }, [multiline]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;
    onSubmit();
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!isLoading) onSubmit();
    }
  };

  const handleSingleInputPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!allowAutoMultilinePaste) return;
    const pasted = event.clipboardData?.getData('text/plain');
    if (!pasted || !/[\r\n]/.test(pasted)) return;

    const el = event.currentTarget;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const nextValue = `${value.slice(0, start)}${pasted}${value.slice(end)}`;

    if (extractUrlsFromInput(nextValue).validUrls.length < AUTO_BULK_URL_THRESHOLD) {
      return;
    }

    event.preventDefault();
    const nextCaret = start + pasted.length;
    pendingSelectionRef.current = {
      start: nextCaret,
      end: nextCaret,
      wasFocused: true,
    };
    onChange(nextValue);
  };

  const borderClass = error
    ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)]'
    : 'border-[var(--color-border)] focus:border-[var(--color-amber)]';

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full min-w-0 flex-1">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>

      <div className="relative w-full">
        {multiline ? (
          <textarea
            ref={textareaRef}
            id={inputId}
            rows={rows}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(event) => {
              const el = event.currentTarget;
              pendingSelectionRef.current = {
                start: el.selectionStart ?? el.value.length,
                end: el.selectionEnd ?? el.value.length,
                wasFocused: document.activeElement === el,
              };
              onChange(el.value);
            }}
            onKeyDown={handleTextareaKeyDown}
            placeholder={placeholder}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? errorId : undefined}
            className={`min-h-[112px] max-h-[240px] w-full resize-y rounded-[var(--radius-md)] border bg-[var(--color-surface)] py-3 pr-12 pl-4 text-left text-sm leading-relaxed text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] outline-none focus:outline-none focus-visible:outline-none transition-colors duration-150 sm:text-base ${borderClass}`}
          />
        ) : (
          <input
            ref={inputRef}
            id={inputId}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onPaste={handleSingleInputPaste}
            onChange={(event) => {
              const el = event.currentTarget;
              pendingSelectionRef.current = {
                start: el.selectionStart ?? el.value.length,
                end: el.selectionEnd ?? el.value.length,
                wasFocused: document.activeElement === el,
              };
              onChange(el.value);
            }}
            placeholder={placeholder}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? errorId : undefined}
            className={`w-full rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-left text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] outline-none focus:outline-none focus-visible:outline-none transition-colors duration-150 ${borderClass} ${
              compact
                ? 'h-10 pr-10 pl-3.5 text-sm'
                : 'h-12 pr-12 pl-4 text-base'
            }`}
          />
        )}

        <button
          type="submit"
          disabled={isLoading}
          aria-busy={isLoading}
          aria-label={isLoading ? loadingLabel : submitLabel}
          title={isLoading ? loadingLabel : submitLabel}
          className={`absolute right-1.5 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-soft)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-amber)] focus-visible:text-[var(--color-amber)] disabled:cursor-not-allowed disabled:opacity-60 ${
            multiline
              ? 'top-1.5 h-9 w-9'
              : compact
                ? 'top-1/2 h-7 w-7 -translate-y-1/2'
                : 'top-1/2 h-9 w-9 -translate-y-1/2'
          }`}
        >
          {isLoading ? (
            <Loader2
              size={compact ? 16 : 18}
              aria-hidden="true"
              className="animate-spin text-[var(--color-amber)]"
            />
          ) : (
            <Search size={compact ? 16 : 18} aria-hidden="true" />
          )}
        </button>
      </div>

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-2.5 text-left text-sm font-medium text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
