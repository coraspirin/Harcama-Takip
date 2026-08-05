import { useState, type FormEvent } from 'react';
import { LogIn, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { ApiError } from '../services/api.ts';
import { Button } from '../components/ui/Button.tsx';
import { TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';

/**
 * Ortak giris ekrani. Rol bazli yonlendirme girisken sonra App.tsx tarafinda
 * yapilir: user -> uygulama, super_admin -> yonetim paneli.
 * Acik kayit ekrani YOKTUR; kullanicilari super admin olusturur.
 */
export default function Giris() {
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Beklenmeyen bir hata olustu');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="rounded-xl bg-brand-600 p-3 text-white">
            <Wallet className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Harcama Takip</h1>
          <p className="text-sm text-slate-600">Devam etmek icin giris yapin</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
        >
          <TextField
            label="Kullanici adi"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />

          <TextField
            label="Sifre"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {error && <Alert tone="error">{error}</Alert>}

          <Button type="submit" loading={loading} className="w-full">
            <LogIn className="h-4 w-4" aria-hidden />
            Giris yap
          </Button>

          <p className="text-center text-xs text-slate-500">
            Hesabiniz yoksa sistem yoneticinizle iletisime gecin.
          </p>
        </form>
      </div>
    </div>
  );
}
