import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync.ts';
import { AUDIT_ACTION_LABELS, adminService } from '../../services/admin.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../../components/ui/Card.tsx';
import { formatDateTime } from '../../lib/format.ts';

const PAGE_SIZE = 50;

/** Silme gibi geri alinamaz islemler listede one cikarilir. */
const DESTRUCTIVE_ACTIONS = new Set(['user.deleted', 'user.deactivated', 'user.password_reset']);

export default function IslemGunlugu() {
  const [page, setPage] = useState(1);
  const log = useAsync(() => adminService.auditLog(page, PAGE_SIZE), [page]);

  const logs = log.data?.logs ?? [];
  const pagination = log.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Islem gunlugu"
        description="Yonetim panelinde yapilan tum islemlerin kaydi"
      />

      {log.error && (
        <div className="mb-4">
          <Alert tone="error">{log.error}</Alert>
        </div>
      )}

      {!log.loading && logs.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="Henuz kayit yok"
            description="Kullanici olusturma, silme, devre disi birakma ve sifre sifirlama islemleri burada listelenir."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="pb-2 font-medium">Tarih</th>
                  <th className="pb-2 font-medium">Islem</th>
                  <th className="pb-2 font-medium">Hedef</th>
                  <th className="pb-2 font-medium">Yapan</th>
                  <th className="pb-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap py-2.5 text-slate-500">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={
                          DESTRUCTIVE_ACTIONS.has(entry.action)
                            ? 'font-medium text-red-700'
                            : 'text-slate-900'
                        }
                      >
                        {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-700">{entry.targetUsername ?? '—'}</td>
                    <td className="py-2.5 text-slate-700">{entry.actorUsername}</td>
                    <td className="py-2.5 text-slate-400">{entry.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pagination && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {pagination.total} kayit · sayfa {pagination.page}/{totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Onceki
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Sonraki
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
