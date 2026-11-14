import type { ProtectionSettings } from '../../types/settings';

interface ProtectionSettingsProps {
  protection: ProtectionSettings;
  onUpdate: (patch: Partial<ProtectionSettings>) => void;
}

interface ToggleRowProps {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ id, title, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text)]">
          {title}
        </label>
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>

      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-amber-strong)]"
      />
    </div>
  );
}

export function ProtectionSettingsSection({
  protection,
  onUpdate,
}: ProtectionSettingsProps) {
  return (
    <section
      aria-labelledby="perlindungan-heading"
      className="space-y-3 border-b border-[var(--color-border)] pb-6"
    >
      <div>
        <h2
          id="perlindungan-heading"
          className="text-base font-semibold text-[var(--color-text)]"
        >
          Perlindungan
        </h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Pengaturan ini langsung diterapkan saat Anda menjalankan pemeriksaan URL baru atau memeriksa ulang halaman.
        </p>
      </div>

      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        <ToggleRow
          id="setting-enable-filter"
          title="Pencocokan daftar filter iklan & pelacak"
          description="Menandai aset dan tautan pada HTML statis yang cocok dengan subset aturan jaringan EasyList/EasyPrivacy."
          checked={protection.enableFilterMatching}
          onChange={(checked) => onUpdate({ enableFilterMatching: checked })}
        />

        <ToggleRow
          id="setting-warn-suspicious"
          title="Peringatan tautan perlu ditinjau"
          description="Menampilkan indikator heuristik untuk pemendek tautan, ketidaksesuaian domain teks, dan tautan umpan pengalihan."
          checked={protection.warnSuspiciousLinks}
          onChange={(checked) => onUpdate({ warnSuspiciousLinks: checked })}
        />

        <ToggleRow
          id="setting-reject-downgrade"
          title="Tolak penurunan protokol HTTPS ke HTTP"
          description="Menghentikan inspeksi ketika pengalihan memaksa turun dari koneksi HTTPS ke HTTP tidak terenkripsi."
          checked={protection.rejectProtocolDowngrade}
          onChange={(checked) => onUpdate({ rejectProtocolDowngrade: checked })}
        />

        <ToggleRow
          id="setting-bypass-external-links"
          title="Bypass klik & paksa masuk ke luar situs (Anti keluar-link)"
          description="Menahan pengalihan, popup, tombol jebakan, dan klik elemen yang mengarahkan keluar dari domain situs yang sedang dibuka agar tetap berada di halaman."
          checked={protection.bypassExternalLinks}
          onChange={(checked) => onUpdate({ bypassExternalLinks: checked })}
        />
      </div>

      <p className="text-xs leading-relaxed text-[var(--color-text-soft)]">
        Catatan keterbatasan: dalam mode aplikasi web, CDNFREE memeriksa HTML statis di server dan tidak dapat menjamin pemblokiran iklan tingkat peramban di dalam iframe lintas-asal. CDNFREE juga tidak menyediakan fitur untuk melewati CAPTCHA, login, paywall, atau kontrol akses situs.
      </p>
    </section>
  );
}
