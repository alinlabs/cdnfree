interface LoadingStateProps {
  label?: string;
  rows?: number;
}

export function LoadingState({
  label = 'Memuat data...',
  rows = 3,
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6"
    >
      <p className="text-sm font-medium text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-4 space-y-3" aria-hidden="true">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className={`h-4 rounded bg-[var(--color-surface-subtle)] animate-pulse ${
              index === rows - 1 ? 'w-2/3' : 'w-full'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
