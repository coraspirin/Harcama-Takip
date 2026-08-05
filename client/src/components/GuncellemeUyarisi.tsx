import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, RefreshCw, X } from 'lucide-react';
import { Button } from './ui/Button.tsx';

/**
 * Yeni surum bildirimi.
 *
 * Service worker kayitli bir uygulamada guncelleme OTOMATIK devreye girmez;
 * bu uyari olmadan kullanicilar onbellekteki eski surumde takili kalir - PWA
 * projelerinde en sik yasanan sorun budur.
 *
 * Guncelleme otomatik uygulanmaz: kullanici bir form doldururken sayfayi
 * yenilemek veri kaybettirir. Karar kullanicinin.
 */
export function GuncellemeUyarisi() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('[pwa] service worker kaydedilemedi:', error);
    },
  });

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:bottom-4">
      <div className="flex w-full max-w-sm items-start gap-3 rounded-xl bg-slate-900 px-4 py-3 text-white shadow-lg">
        {needRefresh ? (
          <>
            <Download className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Yeni surum hazir</p>
              <p className="mt-0.5 text-xs text-slate-300">
                Yenilediginizde en guncel surume gecersiniz.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => void updateServiceWorker(true)}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Yenile
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-slate-300 hover:bg-white/10 hover:text-white"
                  onClick={() => setNeedRefresh(false)}
                >
                  Sonra
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-sm">
              Uygulama cevrimdisi acilmaya hazir. Internetiniz olmadiginda da baslatabilirsiniz
              (veriler icin baglanti gerekir).
            </p>
            <button
              onClick={() => setOfflineReady(false)}
              className="shrink-0 rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white"
              aria-label="Kapat"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
