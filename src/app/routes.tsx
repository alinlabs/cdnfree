import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from '../components/layout';
import { LoadingState } from '../components/loading-state';
import { PageContainer } from '../components/page-container';
import { BerandaPage } from '../pages/beranda';
import { getRouteTitle } from '../utils/route-meta';

const HasilPencarianPage = lazy(() =>
  import('../pages/hasil-pencarian').then((m) => ({
    default: m.HasilPencarianPage,
  })),
);

const RiwayatPencarianPage = lazy(() =>
  import('../pages/riwayat-pencarian').then((m) => ({
    default: m.RiwayatPencarianPage,
  })),
);

const MarkahPage = lazy(() =>
  import('../pages/markah').then((m) => ({
    default: m.MarkahPage,
  })),
);

const PengaturanPage = lazy(() =>
  import('../pages/pengaturan').then((m) => ({
    default: m.PengaturanPage,
  })),
);

const NotFoundPage = lazy(() =>
  import('../pages/not-found').then((m) => ({
    default: m.NotFoundPage,
  })),
);

function DocumentTitleSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = getRouteTitle(pathname);
  }, [pathname]);

  return null;
}

function RouteFallback() {
  return (
    <PageContainer className="py-10">
      <LoadingState label="Memuat halaman CDNFREE..." rows={4} />
    </PageContainer>
  );
}

export function AppRoutes() {
  return (
    <Layout>
      <DocumentTitleSync />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<BerandaPage />} />
          <Route path="/search/*" element={<HasilPencarianPage />} />
          <Route path="/hasil-pencarian/*" element={<HasilPencarianPage />} />
          <Route path="/riwayat-pencarian" element={<RiwayatPencarianPage />} />
          <Route path="/markah" element={<MarkahPage />} />
          <Route path="/pengaturan" element={<PengaturanPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
