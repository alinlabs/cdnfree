interface AnalysisLimitationsSectionProps {
  limitations: string[];
}

export function AnalysisLimitationsSection({
  limitations,
}: AnalysisLimitationsSectionProps) {
  return (
    <section
      aria-labelledby="batasan-inspeksi-heading"
      className="border-t border-[var(--color-border)] pt-5"
    >
      <h2
        id="batasan-inspeksi-heading"
        className="text-xs font-semibold text-[var(--color-text-soft)]"
      >
        Batasan & catatan analisis ({limitations.length})
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-[var(--color-text-muted)]">
        {limitations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
