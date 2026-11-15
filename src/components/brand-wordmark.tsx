import { Link } from 'react-router-dom';

interface BrandWordmarkProps {
  size?: 'sm' | 'md' | 'lg';
  asLink?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-sm tracking-[-0.02em] gap-1',
  md: 'text-base sm:text-lg tracking-[-0.025em] gap-1.5',
  lg: 'text-2xl sm:text-[28px] tracking-[-0.03em] gap-1.5',
};

const CARD_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'rounded-[5px] px-1.5 py-[3px]',
  md: 'rounded-[6px] px-2 py-1',
  lg: 'rounded-[8px] px-2.5 py-1',
};

export function BrandWordmark({
  size = 'md',
  asLink = true,
  className = '',
}: BrandWordmarkProps) {
  const content = (
    <span
      className={`inline-flex items-center font-bold leading-none select-none whitespace-nowrap shrink-0 ${SIZE_CLASSES[size]} ${className}`}
    >
      <span
        className={`inline-flex items-center justify-center bg-[var(--color-amber)] text-white dark:text-[var(--color-on-amber)] ${CARD_CLASSES[size]}`}
      >
        CDN
      </span>
      <span className="text-[var(--color-text)]">FREE</span>
    </span>
  );

  if (!asLink) {
    return content;
  }

  return (
    <Link
      to="/"
      aria-label="CDNFREE — Beranda"
      className="inline-flex items-center rounded-sm no-underline focus-visible:outline-2 focus-visible:outline-[var(--color-amber-strong)]"
    >
      {content}
    </Link>
  );
}
