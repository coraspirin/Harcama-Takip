import { useEffect, useRef, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { notificationService } from '../services/scheduled.ts';
import { Button } from './ui/Button.tsx';
import { formatDateTime } from '../lib/format.ts';

/**
 * Uyari zili. Bildirimler zamanlanmis gorev tarafindan uretilir; burada
 * yalnizca okunur ve okundu isaretlenir.
 */
export function BildirimZili() {
  const [open, setOpen] = useState(false);
  const data = useAsync(() => notificationService.list(), []);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = data.data?.unreadCount ?? 0;
  const notifications = data.data?.notifications ?? [];

  async function handleMarkAll() {
    await notificationService.markAllRead();
    await data.reload();
  }

  async function handleMarkOne(id: number) {
    await notificationService.markRead(id);
    await data.reload();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void data.reload();
        }}
        className="relative rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        aria-label={unread > 0 ? `${unread} okunmamis bildirim` : 'Bildirimler'}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Bildirimler</p>
            {unread > 0 && (
              <Button size="sm" variant="ghost" onClick={() => void handleMarkAll()}>
                <Check className="h-3.5 w-3.5" aria-hidden />
                Tumunu okundu isaretle
              </Button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                Henuz bildirim yok. Vadesi yaklasan odemeler burada gorunur.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className={`px-4 py-3 ${notification.read ? '' : 'bg-brand-50/50'}`}
                  >
                    <button
                      className="w-full text-left"
                      onClick={() => void handleMarkOne(notification.id)}
                    >
                      <div className="flex items-start gap-2">
                        {!notification.read && (
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{notification.title}</p>
                          {notification.body && (
                            <p className="mt-0.5 text-xs text-slate-600">{notification.body}</p>
                          )}
                          <p className="mt-1 text-xs text-slate-400">
                            {formatDateTime(notification.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
