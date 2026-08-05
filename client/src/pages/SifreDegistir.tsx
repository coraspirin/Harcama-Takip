import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { ApiError } from '../services/api.ts';
import { Button } from '../components/ui/Button.tsx';
import { TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';

/**
 * Zorunlu sifre degistirme ekrani. Super admin bir hesabin sifresini
 * sifirladiginda kullanici, sifresini degistirene kadar uygulamanin geri
 * kalanina erisemez (kilit backend'de zorlanir).
 */
export default function SifreDegistir() {
  const { changePassword, logout, user } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordAgain, setNewPasswordAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (newPassword !== newPasswordAgain) {
      setFieldErrors({ newPasswordAgain: 'Sifreler eslesmiyor' });
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError('Beklenmeyen bir hata olustu');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="rounded-xl bg-amber-500 p-3 text-white">
            <KeyRound className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Sifrenizi degistirin</h1>
          <p className="text-sm text-slate-600">
            Hesabinizin sifresi yonetici tarafindan sifirlanmis. Devam etmek icin yeni bir sifre
            belirleyin.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
        >
          <input type="hidden" autoComplete="username" value={user?.username ?? ''} readOnly />

          <TextField
            label="Mevcut sifre"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
            error={fieldErrors['currentPassword']}
          />

          <TextField
            label="Yeni sifre"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            hint="En az 8 karakter"
            error={fieldErrors['newPassword']}
          />

          <TextField
            label="Yeni sifre (tekrar)"
            type="password"
            value={newPasswordAgain}
            onChange={(e) => setNewPasswordAgain(e.target.value)}
            autoComplete="new-password"
            required
            error={fieldErrors['newPasswordAgain']}
          />

          {error && <Alert tone="error">{error}</Alert>}

          <Alert tone="info">
            Sifreniz degistiginde diger tum cihazlardaki oturumlariniz kapatilir.
          </Alert>

          <Button type="submit" loading={loading} className="w-full">
            Sifreyi degistir
          </Button>

          <Button type="button" variant="ghost" className="w-full" onClick={() => void logout()}>
            Cikis yap
          </Button>
        </form>
      </div>
    </div>
  );
}
