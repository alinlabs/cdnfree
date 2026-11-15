interface SettingSwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelledBy?: string;
  ariaLabel?: string;
}

export function SettingSwitch({
  id,
  checked,
  onChange,
  labelledBy,
  ariaLabel,
}: SettingSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-amber-strong)] ${
        checked
          ? 'border-[var(--color-amber)] bg-[var(--color-amber)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface-subtle)] hover:border-[var(--color-text-soft)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 rounded-full shadow-xs transition-transform duration-150 ${
          checked
            ? 'translate-x-[22px] bg-white'
            : 'translate-x-[3px] bg-[var(--color-text-muted)]'
        }`}
      />
    </button>
  );
}
