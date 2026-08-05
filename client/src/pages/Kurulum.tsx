import { useState, type FormEvent } from 'react';
import { ShieldCheck, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { ApiError } from '../services/api.ts';
import { Button } from '../components/ui/Button.tsx';
import { TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';

/**
 * Uygulama ilk kez calistirildiginda gosterilir ve tek super admin hesabini
 * olusturur. Kurulum tamamlandiktan sonra bu ekrana bir daha ulasilamaz.
 */
export default function Kurulum() {
  const { completeSetup } = useAuth();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (password !== passwordAgain) {
      setFieldErrors({ passwordAgain: 'Sifreler eslesmiyor' });
      return;
    }

    setLoading(true);
    try {
      await completeSetup({ username, email: email || undefined, password });
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
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="rounded-xl bg-brand-600 p-3 text-white">
            <Wallet className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Harcama Takip kurulumu</h1>
          <p className="text-sm text-slate-600">
            Uygulama ilk kez calisiyor. Kullanici hesaplarini yonetecek olan{' '}
            <strong>super admin</strong> hesabini simdi olusturun.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
        >
          <Alert tone="warning" title="Bu ekran yalnizca bir kez gosterilir">
            Super admin yalnizca hesap yonetimi yapar; hicbir kullanicinin finansal verisini
            goremez. Sifrenizi guvenli bir yerde saklayin.
          </Alert>

          <TextField
            label="Kullanici adi"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            hint="Harf, rakam, nokta, alt tire ve tire kullanilabilir"
            error={fieldErrors['username']}
          />

          <TextField
            label="E-posta (istege bagli)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            error={fieldErrors['email']}
          />

          <TextField
            label="Sifre"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            hint="En az 8 karakter"
            error={fieldErrors['password']}
          />

          <TextField
            label="Sifre (tekrar)"
            type="password"
            value={passwordAgain}
            onChange={(e) => setPasswordAgain(e.target.value)}
            autoComplete="new-password"
            required
            error={fieldErrors['passwordAgain']}
          />

          {error && <Alert tone="error">{error}</Alert>}

          <Button type="submit" loading={loading} className="w-full">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Super admin hesabini olustur
          </Button>
        </form>
      </div>
    </div>
  );
}
