export interface NavRouteItem {
  path: string;
  label: string;
  title: string;
}

export const PRIMARY_NAV_ROUTES: NavRouteItem[] = [
  {
    path: '/',
    label: 'Beranda',
    title: 'CDNFREE — Inspeksi Tautan & Penjelajahan Lebih Aman',
  },
  {
    path: '/riwayat-pencarian',
    label: 'Riwayat',
    title: 'Riwayat Pencarian — CDNFREE',
  },
  {
    path: '/markah',
    label: 'Markah',
    title: 'Markah Media — CDNFREE',
  },
  {
    path: '/pengaturan',
    label: 'Pengaturan',
    title: 'Pengaturan — CDNFREE',
  },
];

export const ROUTE_TITLES: Record<string, string> = {
  '/': 'CDNFREE — Inspeksi Tautan & Penjelajahan Lebih Aman',
  '/search': 'Hasil Inspeksi — CDNFREE',
  '/search/web': 'Tampilan Web — Hasil Inspeksi — CDNFREE',
  '/search/detail': 'Detail Inspeksi — CDNFREE',
  '/search/aset': 'Aset Manager — CDNFREE',
  '/hasil-pencarian': 'Hasil Inspeksi — CDNFREE',
  '/hasil-pencarian/web': 'Tampilan Web — Hasil Inspeksi — CDNFREE',
  '/hasil-pencarian/detail': 'Detail Inspeksi — CDNFREE',
  '/hasil-pencarian/aset': 'Aset Manager — CDNFREE',
  '/riwayat-pencarian': 'Riwayat Pencarian — CDNFREE',
  '/markah': 'Markah Media — CDNFREE',
  '/pengaturan': 'Pengaturan — CDNFREE',
};

export function getRouteTitle(pathname: string): string {
  const normalized = pathname !== '/' && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  return ROUTE_TITLES[normalized] ?? 'Halaman Tidak Ditemukan — CDNFREE';
}

export function isRouteActive(currentPathname: string, targetPath: string): boolean {
  if (targetPath === '/') {
    return currentPathname === '/';
  }
  return currentPathname === targetPath || currentPathname.startsWith(`${targetPath}/`);
}

export function shouldShowGlobalNav(pathname: string): boolean {
  return !isRouteActive(pathname, '/search') && !isRouteActive(pathname, '/hasil-pencarian');
}
