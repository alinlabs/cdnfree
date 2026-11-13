import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-6 sm:p-8 text-center">
      <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-[52ch] text-sm text-[var(--color-text-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
