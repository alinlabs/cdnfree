import { useState } from 'react';
import { Modal } from './modal';
import { PageContainer } from './page-container';

type InfoDialogKind = 'privacy' | 'about' | null;

export function Footer() {
  const [activeDialog, setActiveDialog] = useState<InfoDialogKind>(null);

  return (
    <>
      <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg)] pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:py-3">
        <PageContainer>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-xs text-[var(--color-text-soft)]">
              © {new Date().getFullYear()} CDNFREE
            </p>

            <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
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
