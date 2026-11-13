import { useState } from 'react';
import { BrandWordmark } from './brand-wordmark';
import { Modal } from './modal';
import { PageContainer } from './page-container';

type InfoDialogKind = 'privacy' | 'about' | null;

interface FooterProps {
  compactBottomPadding?: boolean;
}

export function Footer({ compactBottomPadding = false }: FooterProps) {
  const [activeDialog, setActiveDialog] = useState<InfoDialogKind>(null);

  return (
    <>
      <footer
        className={`border-t border-[var(--color-border)] bg-[var(--color-bg)] ${
          compactBottomPadding
            ? 'pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:py-6'
            : 'pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:py-6'
        }`}
      >
        <PageContainer>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
              <BrandWordmark size="sm" asLink={false} />
              <p className="text-xs text-[var(--color-text-muted)]">
                Inspeksi tautan publik, rantai pengalihan, dan inventaris aset web.
              </p>
            </div>

            <div className="flex items-center gap-5 text-xs text-[var(--color-text-muted)]">
              <button
                type="button"
                onClick={() => setActiveDialog('privacy')}
                className="whitespace-nowrap font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:text-[var(--color-text)]"
              >
                Privasi
              </button>
              <button
                type="button"
                onClick={() => setActiveDialog('about')}
                className="whitespace-nowrap font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:text-[var(--color-text)]"
              >
                Tentang
              </button>
              <span className="tabular-nums text-[var(--color-text-soft)]">
                v0.1.0
              </span>
            </div>
          </div>
        </PageContainer>
      </footer>

      <Modal
        open={activeDialog === 'privacy'}
        onClose={() => setActiveDialog(null)}
        title="Privasi di CDNFREE"
        footer={
          <button
            type="button"
            onClick={() => setActiveDialog(null)}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            Tutup
          </button>
        }
      >
        <div className="space-y-3 leading-relaxed">
          <p>
            CDNFREE dirancang untuk meminimalkan penyimpanan data penjelajahan. Riwayat pencarian dan pengaturan disimpan secara lokal di peramban Anda dan dapat dihapus kapan saja.
          </p>
          <p>
            Parameter kueri yang berpotensi sensitif (seperti token atau kunci sesi) disamarkan dari riwayat yang ditampilkan dan tidak dikirim ke layanan pihak ketiga secara default.
          </p>
        </div>
      </Modal>

      <Modal
        open={activeDialog === 'about'}
        onClose={() => setActiveDialog(null)}
        title="Tentang CDNFREE"
        footer={
          <button
            type="button"
            onClick={() => setActiveDialog(null)}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]"
          >
            Tutup
          </button>
        }
      >
        <div className="space-y-3 leading-relaxed">
          <p>
            CDNFREE membantu memeriksa tujuan akhir tautan, rantai pengalihan HTTP, host CDN, serta aset statis yang dapat diakses secara publik sebelum Anda membuka situs tujuan.
          </p>
          <p>
            CDNFREE adalah aplikasi web inspeksi, bukan mesin peramban penuh. Situs yang membatasi penyematan melalui header keamanan tetap dibuka langsung di tab baru atas keputusan pengguna.
          </p>
        </div>
      </Modal>
    </>
  );
}
