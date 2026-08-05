import { NavLink, Outlet } from 'react-router-dom';
import { ClipboardList, LogOut, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

const NAV = [
  { to: '/admin/kullanicilar', label: 'Kullanicilar', icon: Users },
  { to: '/admin/islem-gunlugu', label: 'Islem gunlugu', icon: ClipboardList },
] as const;

/**
 * Super admin arayuzu. Normal kullanici arayuzuyle YANLISLIKLA karistirilmasin
 * diye bilincli olarak farkli bir renk ailesi (amber) ve koyu bir ust cubuk
 * kullanir.
 */
export default function AdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-dvh bg-admin-50">
      <header className="bg-admin-900 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-admin-500 p-1.5">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Yonetim Paneli</p>
              <p className="text-xs leading-tight text-admin-100/80">
                Yalnizca hesap yonetimi - finansal veriye erisim yok
              </p>
            </div>
          </div>

          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-admin-600 text-white' : 'text-admin-100 hover:bg-white/10'
                  }`
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-admin-100/80 sm:inline">{user?.username}</span>
            <button
              onClick={() => void logout()}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-admin-100 transition-colors hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Cikis
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
