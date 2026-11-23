import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import type { AuthStatus } from './context/AuthContext.tsx';
import type { User } from './types/index.ts';
import { AppRoutes } from './App.tsx';

const authState: { status: AuthStatus; user: User | null } = { status: 'loading', user: null };

vi.mock('./context/AuthContext.tsx', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => authState,
}));

vi.mock('./components/ui/Card.tsx', () => ({
  FullPageSpinner: () => <div>spinner</div>,
}));
vi.mock('./components/GuncellemeUyarisi.tsx', () => ({ GuncellemeUyarisi: () => null }));

vi.mock('./layouts/AppLayout.tsx', () => ({
  default: () => (
    <div>
      layout:App
      <Outlet />
    </div>
  ),
}));
vi.mock('./layouts/AdminLayout.tsx', () => ({
  default: () => (
    <div>
      layout:Admin
      <Outlet />
    </div>
  ),
}));

vi.mock('./pages/Kurulum.tsx', () => ({ default: () => <div>sayfa:Kurulum</div> }));
vi.mock('./pages/Giris.tsx', () => ({ default: () => <div>sayfa:Giris</div> }));
vi.mock('./pages/SifreDegistir.tsx', () => ({ default: () => <div>sayfa:SifreDegistir</div> }));
vi.mock('./pages/Ayarlar.tsx', () => ({ default: () => <div>sayfa:Ayarlar</div> }));
vi.mock('./pages/Dashboard.tsx', () => ({ default: () => <div>sayfa:Dashboard</div> }));
vi.mock('./pages/Islemler.tsx', () => ({ default: () => <div>sayfa:Islemler</div> }));
vi.mock('./pages/Kategoriler.tsx', () => ({ default: () => <div>sayfa:Kategoriler</div> }));
vi.mock('./pages/Butce.tsx', () => ({ default: () => <div>sayfa:Butce</div> }));
vi.mock('./pages/Borclar.tsx', () => ({ default: () => <div>sayfa:Borclar</div> }));
vi.mock('./pages/Birikimler.tsx', () => ({ default: () => <div>sayfa:Birikimler</div> }));
vi.mock('./pages/Takvim.tsx', () => ({ default: () => <div>sayfa:Takvim</div> }));
vi.mock('./pages/Raporlar.tsx', () => ({ default: () => <div>sayfa:Raporlar</div> }));
vi.mock('./pages/BekleyenOdemeler.tsx', () => ({
  default: () => <div>sayfa:BekleyenOdemeler</div>,
}));
vi.mock('./pages/admin/Kullanicilar.tsx', () => ({
  default: () => <div>sayfa:Kullanicilar</div>,
}));
vi.mock('./pages/admin/IslemGunlugu.tsx', () => ({
  default: () => <div>sayfa:IslemGunlugu</div>,
}));

function LocationDisplay() {
  const loc = useLocation();
  return <div data-testid="konum">{loc.pathname + loc.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <LocationDisplay />
    </MemoryRouter>,
  );
}

function makeUser(over: Partial<User> = {}): User {
  return {
    id: 1,
    username: 'ali',
    email: null,
    role: 'user',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function setAuth(status: AuthStatus, user: User | null = null) {
  authState.status = status;
  authState.user = user;
}

const konum = () => screen.getByTestId('konum').textContent;

beforeEach(() => setAuth('loading'));

describe('AppRoutes yonlendirme', () => {
  it('loading: spinner gosterir', () => {
    renderAt('/islemler');
    expect(screen.getByText('spinner')).toBeInTheDocument();
    expect(konum()).toBe('/islemler');
  });

  it('setup-required: her yol /kurulum a gider', () => {
    setAuth('setup-required');
    renderAt('/islemler');
    expect(konum()).toBe('/kurulum');
    expect(screen.getByText('sayfa:Kurulum')).toBeInTheDocument();
  });

  it('anonymous: her yol /giris e gider', () => {
    setAuth('anonymous');
    renderAt('/admin/kullanicilar');
    expect(konum()).toBe('/giris');
    expect(screen.getByText('sayfa:Giris')).toBeInTheDocument();
  });

  it('anonymous: /kurulum acilmaz, /giris e gider', () => {
    setAuth('anonymous');
    renderAt('/kurulum');
    expect(konum()).toBe('/giris');
  });

  it('authenticated ama user yok: giris ekrani', () => {
    setAuth('authenticated', null);
    renderAt('/');
    expect(konum()).toBe('/giris');
  });

  it.each(['/', '/islemler', '/admin/kullanicilar', '/giris'])(
    'mustChangePassword: %s istense de /sifre-degistir',
    (path) => {
      setAuth('authenticated', makeUser({ mustChangePassword: true }));
      renderAt(path);
      expect(konum()).toBe('/sifre-degistir');
      expect(screen.getByText('sayfa:SifreDegistir')).toBeInTheDocument();
      expect(screen.queryByText(/layout:/)).not.toBeInTheDocument();
    },
  );

  it('mustChangePassword super_admin icin de gecerli', () => {
    setAuth('authenticated', makeUser({ role: 'super_admin', mustChangePassword: true }));
    renderAt('/admin/kullanicilar');
    expect(konum()).toBe('/sifre-degistir');
  });

  describe('super_admin', () => {
    beforeEach(() => setAuth('authenticated', makeUser({ role: 'super_admin' })));

    it.each(['/', '/islemler', '/giris', '/bilinmeyen'])('%s -> /admin/kullanicilar', (path) => {
      renderAt(path);
      expect(konum()).toBe('/admin/kullanicilar');
      expect(screen.getByText('layout:Admin')).toBeInTheDocument();
      expect(screen.getByText('sayfa:Kullanicilar')).toBeInTheDocument();
    });

    it('/admin -> /admin/kullanicilar', () => {
      renderAt('/admin');
      expect(konum()).toBe('/admin/kullanicilar');
    });

    it('/admin/islem-gunlugu acilir', () => {
      renderAt('/admin/islem-gunlugu');
      expect(konum()).toBe('/admin/islem-gunlugu');
      expect(screen.getByText('sayfa:IslemGunlugu')).toBeInTheDocument();
    });

    it('user ekranlari agacta yok', () => {
      renderAt('/islemler');
      expect(screen.queryByText('sayfa:Islemler')).not.toBeInTheDocument();
      expect(screen.queryByText('layout:App')).not.toBeInTheDocument();
    });
  });

  describe('user', () => {
    beforeEach(() => setAuth('authenticated', makeUser()));

    it('/ Dashboard acar', () => {
      renderAt('/');
      expect(screen.getByText('layout:App')).toBeInTheDocument();
      expect(screen.getByText('sayfa:Dashboard')).toBeInTheDocument();
    });

    it('/islemler acilir', () => {
      renderAt('/islemler');
      expect(konum()).toBe('/islemler');
      expect(screen.getByText('sayfa:Islemler')).toBeInTheDocument();
    });

    it.each(['/admin/kullanicilar', '/admin', '/giris', '/bilinmeyen'])('%s -> /', (path) => {
      renderAt(path);
      expect(konum()).toBe('/');
      expect(screen.getByText('sayfa:Dashboard')).toBeInTheDocument();
      expect(screen.queryByText('layout:Admin')).not.toBeInTheDocument();
    });

    it.each([
      ['/planlanan', '/bekleyen?sekme=planlanan'],
      ['/taksitler', '/bekleyen?sekme=taksit'],
      ['/faturalar', '/bekleyen?sekme=fatura'],
    ])('eski adres %s -> %s', (from, to) => {
      renderAt(from);
      expect(konum()).toBe(to);
      expect(screen.getByText('sayfa:BekleyenOdemeler')).toBeInTheDocument();
    });
  });
});
