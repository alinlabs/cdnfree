interface TopProgressLineProps {
  visible: boolean;
  placement?: 'header-bottom' | 'viewport-top';
  label?: string;
}

export function TopProgressLine({
  visible,
  placement = 'viewport-top',
  label = 'Memuat...',
}: TopProgressLineProps) {
  if (!visible) return null;

  const positionClass =
    placement === 'header-bottom'
      ? 'absolute right-0 bottom-0 left-0 z-40'
      : 'fixed top-0 right-0 left-0 z-50';

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy="true"
      className={`${positionClass} pointer-events-none h-[3px] w-full overflow-hidden bg-[var(--color-amber-soft)]`}
    >
      <div className="cdnfree-progress-bar h-full w-full origin-left bg-[var(--color-amber)]" />
    </div>
  );
}
