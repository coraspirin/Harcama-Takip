import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { FullPageSpinner } from './components/ui/Card.tsx';
import AppLayout from './layouts/AppLayout.tsx';
import AdminLayout from './layouts/AdminLayout.tsx';
import Kurulum from './pages/Kurulum.tsx';
import Giris from './pages/Giris.tsx';
import SifreDegistir from './pages/SifreDegistir.tsx';
import Ayarlar from './pages/Ayarlar.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Hesaplar from './pages/Hesaplar.tsx';
import Islemler from './pages/Islemler.tsx';
import Yakinda from './pages/Yakinda.tsx';

/**
 * Yonlendirme tamamen oturum durumuna gore kurulur: kullanicinin erisemeyecegi
 * route'lar agacta HIC yer almaz. (Yetki kontrolu ayrica backend'de zorunlu
 * kilinmistir; buradaki ayrim UX icindir, guvenlik siniri degildir.)
 */
function AppRoutes() {
  const { status, user } = useAuth();

  if (status === 'loading') return <FullPageSpinner />;

  if (status === 'setup-required') {
    return (
      <Routes>
        <Route path="/kurulum" element={<Kurulum />} />
        <Route path="*" element={<Navigate to="/kurulum" replace />} />
      </Routes>
    );
  }

  if (status === 'anonymous' || !user) {
    return (
      <Routes>
        <Route path="/giris" element={<Giris />} />
        <Route path="*" element={<Navigate to="/giris" replace />} />
      </Routes>
    );
  }

  // Yonetici sifreyi sifirladiysa, degistirilene kadar baska hicbir ekran acilmaz.
  if (user.mustChangePassword) {
    return (
      <Routes>
        <Route path="/sifre-degistir" element={<SifreDegistir />} />
        <Route path="*" element={<Navigate to="/sifre-degistir" replace />} />
      </Routes>
    );
  }

  if (user.role === 'super_admin') {
    return (
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/kullanicilar" replace />} />
          <Route
            path="kullanicilar"
            element={<Yakinda title="Kullanicilar" phase="Faz 7 (Super admin paneli)" />}
          />
          <Route
            path="islem-gunlugu"
            element={<Yakinda title="Islem gunlugu" phase="Faz 7 (Super admin paneli)" />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/admin/kullanicilar" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="hesaplar" element={<Hesaplar />} />
        <Route path="islemler" element={<Islemler />} />
        <Route
          path="planlanan"
          element={<Yakinda title="Planlanan odemeler" phase="Faz 6 (Zamanlanmis kayitlar)" />}
        />
        <Route
          path="taksitler"
          element={<Yakinda title="Taksitler" phase="Faz 6 (Zamanlanmis kayitlar)" />}
        />
        <Route
          path="faturalar"
          element={<Yakinda title="Faturalar" phase="Faz 6 (Zamanlanmis kayitlar)" />}
        />
        <Route path="raporlar" element={<Yakinda title="Raporlar" phase="Faz 5 (Raporlar)" />} />
        <Route
          path="kategoriler"
          element={<Yakinda title="Kategoriler" phase="Faz 4 (Kategori ve butce)" />}
        />
        <Route path="butce" element={<Yakinda title="Butce" phase="Faz 4 (Kategori ve butce)" />} />
        <Route path="ice-aktar" element={<Yakinda title="Ice aktar" phase="Faz 8 (OCR)" />} />
        <Route path="ayarlar" element={<Ayarlar />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
