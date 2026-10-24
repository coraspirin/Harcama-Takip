import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { FullPageSpinner } from './components/ui/Card.tsx';
import { GuncellemeUyarisi } from './components/GuncellemeUyarisi.tsx';
import AppLayout from './layouts/AppLayout.tsx';
import AdminLayout from './layouts/AdminLayout.tsx';
import Kurulum from './pages/Kurulum.tsx';
import Giris from './pages/Giris.tsx';
import SifreDegistir from './pages/SifreDegistir.tsx';
import Ayarlar from './pages/Ayarlar.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Islemler from './pages/Islemler.tsx';
import Kategoriler from './pages/Kategoriler.tsx';
import Butce from './pages/Butce.tsx';
import Borclar from './pages/Borclar.tsx';
import Raporlar from './pages/Raporlar.tsx';
import BekleyenOdemeler from './pages/BekleyenOdemeler.tsx';
import Kullanicilar from './pages/admin/Kullanicilar.tsx';
import IslemGunlugu from './pages/admin/IslemGunlugu.tsx';

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
          <Route path="kullanicilar" element={<Kullanicilar />} />
          <Route path="islem-gunlugu" element={<IslemGunlugu />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin/kullanicilar" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="islemler" element={<Islemler />} />
        <Route path="bekleyen" element={<BekleyenOdemeler />} />
        {/* Eski adresler: yer imleri ve bildirim baglantilari bozulmasin */}
        <Route path="planlanan" element={<Navigate to="/bekleyen?sekme=planlanan" replace />} />
        <Route path="taksitler" element={<Navigate to="/bekleyen?sekme=taksit" replace />} />
        <Route path="faturalar" element={<Navigate to="/bekleyen?sekme=fatura" replace />} />
        <Route path="borclar" element={<Borclar />} />
        <Route path="raporlar" element={<Raporlar />} />
        <Route path="kategoriler" element={<Kategoriler />} />
        <Route path="butce" element={<Butce />} />
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
      <GuncellemeUyarisi />
    </AuthProvider>
  );
}
