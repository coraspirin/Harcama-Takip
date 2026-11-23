import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

const TOAST_MS = 2500;

/** Kisa, kendiliginden kapanan bildirim. ToastHost mount degilse sessizce yok sayilir. */
export function showToast(message: string): void {
  listeners.forEach((l) => l(message));
}

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const listener: Listener = (m) => setMessage(m);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4"
    >
      {message && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
          {message}
        </div>
      )}
    </div>
  );
}
