import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/empty-state';
import { PageContainer } from '../../components/page-container';

export function NotFoundPage() {
  return (
    <PageContainer className="py-14 sm:py-20">
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-[-0.015em] text-[var(--color-text)]">
          Halaman tidak ditemukan
        </h1>
        <EmptyState
          title="Rute yang Anda tuju tidak tersedia"
          description="Periksa kembali alamat halaman atau kembali ke Beranda CDNFREE untuk memeriksa tautan."
          action={
            <Link
              to="/"
              className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-medium text-[var(--color-on-amber)] transition-colors duration-150 hover:bg-[var(--color-amber-hover)] hover:text-[var(--color-on-amber-hover)]"
            >
              Kembali ke Beranda
            </Link>
          }
        />
      </div>
    </PageContainer>
  );
}
