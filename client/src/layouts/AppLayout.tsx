import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  BarChart3,
  CalendarClock,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  Tags,
  Target,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { BildirimZili } from '../components/BildirimZili.tsx';

const NAV = [
  { to: '/', label: 'Ozet', icon: LayoutDashboard, end: true },
  { to: '/islemler', label: 'Islemler', icon: ArrowLeftRight },
  { to: '/planlanan', label: 'Planlanan', icon: CalendarClock },
  { to: '/taksitler', label: 'Taksitler', icon: CreditCard },
  { to: '/faturalar', label: 'Faturalar', icon: ReceiptText },
  { to: '/raporlar', label: 'Raporlar', icon: BarChart3 },
  { to: '/kategoriler', label: 'Kategoriler', icon: Tags },
  { to: '/butce', label: 'Butce', icon: Target },
  { to: '/ayarlar', label: 'Ayarlar', icon: Settings },
] as const;

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Mobil menude bir baglantiya tiklandiginda menu kapansin
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const navContent = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
      {NAV.map(({ to, label, icon: Icon, ...rest }) => (
        <NavLink
          key={to}
          to={to}
          end={'end' in rest ? rest.end : undefined}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
      <div className="rounded-lg bg-brand-600 p-1.5 text-white">
        <Wallet className="h-4 w-4" aria-hidden />
      </div>
      <span className="font-semibold text-slate-900">Harcama Takip</span>
    </div>
  );

  const footer = (
    <div className="border-t border-slate-200 p-3">
      <div className="mb-2 px-3 text-xs text-slate-500">
        Oturum: <span className="font-medium text-slate-700">{user?.username}</span>
      </div>
      <button
        onClick={() => void logout()}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Cikis yap
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Masaustu kenar cubugu */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        {brand}
        {navContent}
        {footer}
      </aside>

      {/* Mobil ust cubuk */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
          aria-label="Menuyu ac"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-brand-600 p-1 text-white">
            <Wallet className="h-4 w-4" aria-hidden />
          </div>
          <span className="font-semibold text-slate-900">Harcama Takip</span>
        </div>
        <div className="ml-auto">
          <BildirimZili />
        </div>
      </header>

      {/* Mobil cekmece */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMenuOpen(false)}
            aria-label="Menuyu kapat"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pr-2">
              <div className="flex-1">{brand}</div>
              <button
                onClick={() => setMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Menuyu kapat"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {navContent}
            {footer}
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        {/* Masaustunde bildirim zili icin ince ust serit */}
        <div className="sticky top-0 z-20 hidden justify-end border-b border-slate-200 bg-slate-50/80 px-8 py-2 backdrop-blur lg:flex">
          <BildirimZili />
        </div>

        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
