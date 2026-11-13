import type { ReactNode } from 'react';

interface ErrorStateProps {
  title?: string;
  description: string;
  action?: ReactNode;
}

export function ErrorState({
  title = 'Terjadi kendala',
  description,
  action,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6"
    >
      <h2 className="text-base font-semibold text-[var(--color-danger)]">{title}</h2>
      <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
