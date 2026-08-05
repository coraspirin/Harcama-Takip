import { useState, type FormEvent } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { ApiError } from '../services/api.ts';
import { Button } from '../components/ui/Button.tsx';
import { TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, PageHeader } from '../components/ui/Card.tsx';
import { formatDateTime } from '../lib/format.ts';
import BankalarBolumu from './ayarlar/BankalarBolumu.tsx';
import VeriYonetimiBolumu from './ayarlar/VeriYonetimiBolumu.tsx';
import HomeAssistantBolumu from './ayarlar/HomeAssistantBolumu.tsx';

export default function Ayarlar() {
  const { user, activeSessions, changePassword, logoutAll } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordAgain, setNewPasswordAgain] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwFieldErrors, setPwFieldErrors] = useState<Record<string, string>>({});
  const [pwLoading, setPwLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    setPwFieldErrors({});

    if (newPassword !== newPasswordAgain) {
      setPwFieldErrors({ newPasswordAgain: 'Sifreler eslesmiyor' });
      return;
    }

    setPwLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordAgain('');
    } catch (err) {
      if (err instanceof ApiError) {
        setPwError(err.message);
        setPwFieldErrors(err.fieldErrors);
      } else {
        setPwError('Beklenmeyen bir hata olustu');
      }
    } finally {
      setPwLoading(false);
    }
  }

  async function handleLogoutAll() {
    setSessionLoading(true);
    try {
      await logoutAll();
    } finally {
      setSessionLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Ayarlar"
        description="Bankalar, hesap bilgileri ve oturum guvenligi"
      />

      <div className="mb-6 space-y-6">
        <BankalarBolumu />
        <HomeAssistantBolumu />
        <VeriYonetimiBolumu />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Hesap bilgileri">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Kullanici adi</dt>
              <dd className="font-medium text-slate-900">{user?.username}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">E-posta</dt>
              <dd className="font-medium text-slate-900">{user?.email ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Hesap olusturma</dt>
              <dd className="font-medium text-slate-900">
                {user ? formatDateTime(user.createdAt) : '—'}
              </dd>
            </div>
          </dl>
        </Card>

        <Card
          title="Oturumlar"
          description={`Su anda ${activeSessions} aktif oturum bulunuyor.`}
        >
          <Alert tone="info" title="Tum cihazlardan cikis">
            Telefonunuzu kaybettiyseniz veya bir oturumun baskasinda acik kaldigindan
            supheleniyorsaniz tum oturumlari kapatabilirsiniz. Bu islem sizi de cikisa gonderir.
          </Alert>
          <Button
            variant="secondary"
            className="mt-4"
            loading={sessionLoading}
            onClick={() => void handleLogoutAll()}
          >
            <MonitorSmartphone className="h-4 w-4" aria-hidden />
            Tum cihazlardan cikis yap
          </Button>
        </Card>

        <Card title="Sifre degistir" className="lg:col-span-2">
          <form onSubmit={handlePasswordChange} className="max-w-sm space-y-4">
            <input type="hidden" autoComplete="username" value={user?.username ?? ''} readOnly />

            <TextField
              label="Mevcut sifre"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
              error={pwFieldErrors['currentPassword']}
            />
            <TextField
              label="Yeni sifre"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              hint="En az 8 karakter"
              error={pwFieldErrors['newPassword']}
            />
            <TextField
              label="Yeni sifre (tekrar)"
              type="password"
              value={newPasswordAgain}
              onChange={(e) => setNewPasswordAgain(e.target.value)}
              autoComplete="new-password"
              required
              error={pwFieldErrors['newPasswordAgain']}
            />

            {pwError && <Alert tone="error">{pwError}</Alert>}
            {pwSuccess && (
              <Alert tone="success">
                Sifreniz degistirildi. Diger cihazlardaki oturumlariniz kapatildi.
              </Alert>
            )}

            <Button type="submit" loading={pwLoading}>
              Sifreyi degistir
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
