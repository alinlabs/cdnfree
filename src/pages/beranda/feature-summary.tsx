const CAPABILITIES = [
  {
    title: 'Inspeksi tautan',
    description: 'Tujuan akhir dan rantai redirect.',
  },
  {
    title: 'Deteksi gangguan',
    description: 'Domain iklan dan tautan mencurigakan.',
  },
  {
    title: 'Inventaris aset',
    description: 'Host CDN dan resource publik yang ditemukan.',
  },
] as const;

export function FeatureSummary() {
  return (
    <section
      aria-label="Ringkasan kemampuan"
      className="border-t border-[var(--color-border)] pt-8"
    >
      <div className="grid gap-6 sm:grid-cols-3 sm:gap-8">
        {CAPABILITIES.map((item) => (
          <div key={item.title} className="space-y-1">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              {item.title}
            </h2>
            <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
