import { Route, Routes } from 'react-router-dom';
import { Wallet } from 'lucide-react';

/**
 * Faz 0 iskeleti. Yonlendirme agaci Faz 1'de auth ve rol kontrolleriyle
 * birlikte kurulacak.
 */
function Placeholder() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <Wallet className="h-10 w-10 text-brand-600" />
      <h1 className="text-2xl font-semibold">Harcama Takip</h1>
      <p className="max-w-sm text-sm text-slate-500">
        Uygulama iskeleti hazir. Kurulum ve giris ekranlari bir sonraki fazda eklenecek.
      </p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<Placeholder />} />
    </Routes>
  );
}
