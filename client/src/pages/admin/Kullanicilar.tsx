import { useState } from 'react';
import { Copy, KeyRound, Plus, ShieldOff, Trash2, UserCheck, Users } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync.ts';
import { adminService, type AdminUser } from '../../services/admin.ts';
import { ApiError } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/Field.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../../components/ui/Modal.tsx';
import { formatDateTime } from '../../lib/format.ts';

export default function Kullanicilar() {
  const { user: currentAdmin } = useAuth();
  const users = useAsync(() => adminService.listUsers(), []);

  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);

  function openCreate() {
    setUsername('');
    setEmail('');
    setPassword('');
    setMustChange(true);
    setError(null);
    setFormOpen(true);
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      await adminService.createUser({
        username: username.trim(),
        email: email.trim() || undefined,
        password,
        mustChangePassword: mustChange,
      });
      setFormOpen(false);
      setNotice(`"${username.trim()}" olusturuldu.`);
      await users.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Olusturulamadi');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(user: AdminUser) {
    setBusy(true);
    setError(null);
    try {
      await adminService.setActive(user.id, !user.isActive);
      await users.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Islem basarisiz');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!resetting) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminService.resetPassword(resetting.id);
      setTemporaryPassword(res.temporaryPassword);
      setResetting(null);
      await users.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sifirlanamadi');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await adminService.deleteUser(deleting.id);
      setNotice(`"${deleting.username}" ve tum verisi silindi.`);
      setDeleting(null);
      await users.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  const list = users.data ?? [];

  return (
    <>
      <PageHeader
        title="Kullanicilar"
        description="Hesap olusturma, devre disi birakma ve sifre sifirlama"
        actions={
          <Button variant="admin" size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            Kullanici ekle
          </Button>
        }
      />

      <div className="mb-4">
        <Alert tone="info">
          Bu panelde yalnizca hesap yonetimi yapilir. Kullanicilarin finansal verilerine
          (bakiye, islem, kategori) buradan erisim <strong>yoktur</strong>.
        </Alert>
      </div>

      {(users.error || error) && (
        <div className="mb-4">
          <Alert tone="error">{users.error ?? error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      {!users.loading && list.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="Kullanici yok" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="-my-2 divide-y divide-slate-100">
            {list.map((user) => {
              const isSelf = user.id === currentAdmin?.id;
              return (
                <li key={user.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">{user.username}</p>
                      {user.role === 'super_admin' && (
                        <span className="rounded-full bg-admin-100 px-2 py-0.5 text-xs font-medium text-admin-700">
                          super admin
                        </span>
                      )}
                      {!user.isActive && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          pasif
                        </span>
                      )}
                      {user.mustChangePassword && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          sifre degistirmeli
                        </span>
                      )}
                      {isSelf && <span className="text-xs text-slate-500">(siz)</span>}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {user.email ?? 'e-posta yok'} · olusturma {formatDateTime(user.createdAt)}
                    </p>
                  </div>

                  {!isSelf && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void handleToggleActive(user)}
                        aria-label={user.isActive ? 'Devre disi birak' : 'Aktif et'}
                        title={user.isActive ? 'Devre disi birak' : 'Aktif et'}
                      >
                        {user.isActive ? (
                          <ShieldOff className="h-4 w-4" aria-hidden />
                        ) : (
                          <UserCheck className="h-4 w-4 text-emerald-600" aria-hidden />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setResetting(user)}
                        aria-label="Sifre sifirla"
                        title="Sifre sifirla"
                      >
                        <KeyRound className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(user)}
                        aria-label="Sil"
                        title="Sil"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* --- Kullanici olusturma --- */}
      <Modal
        open={formOpen}
        title="Kullanici ekle"
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Vazgec
            </Button>
            <Button variant="admin" loading={busy} onClick={() => void handleCreate()}>
              Olustur
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField
            label="Kullanici adi"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            hint="Harf, rakam, nokta, alt tire ve tire"
            autoFocus
            required
          />
          <TextField
            label="E-posta (istege bagli)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Baslangic sifresi"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="En az 8 karakter. Kullaniciya guvenli bir kanaldan iletin."
            required
          />
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={mustChange}
              onChange={(e) => setMustChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-admin-600 focus:ring-admin-600"
            />
            <span>
              <span className="font-medium text-slate-700">Ilk giriste sifre degistirsin</span>
              <span className="block text-slate-500">
                Onerilir: boylece sizin bildiginiz sifre kalici erisim saglamaz.
              </span>
            </span>
          </label>

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      {/* --- Gecici sifre gosterimi --- */}
      <Modal
        open={temporaryPassword !== null}
        title="Gecici sifre"
        onClose={() => setTemporaryPassword(null)}
        footer={
          <Button variant="admin" onClick={() => setTemporaryPassword(null)}>
            Kapattim, not aldim
          </Button>
        }
      >
        <div className="space-y-4">
          <Alert tone="warning" title="Bu sifre yalnizca bir kez gosterilir">
            Pencereyi kapattiginizda tekrar goruntulenemez. Kullaniciya guvenli bir kanaldan
            iletin; ilk giriste degistirmek zorunda kalacak.
          </Alert>

          <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-sm">{temporaryPassword}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(temporaryPassword ?? '')}
            >
              <Copy className="h-4 w-4" aria-hidden />
              Kopyala
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={resetting !== null}
        title="Sifreyi sifirla"
        loading={busy}
        danger={false}
        confirmLabel="Sifirla"
        onClose={() => setResetting(null)}
        onConfirm={() => void handleReset()}
        message={
          <>
            <strong>{resetting?.username}</strong> icin yeni bir gecici sifre uretilecek. Kullanicinin
            tum acik oturumlari kapanir ve ilk giriste sifresini degistirmesi istenir.
          </>
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Kullaniciyi sil"
        loading={busy}
        confirmLabel="Evet, sil"
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message={
          <>
            <strong>{deleting?.username}</strong> hesabi ve bu hesaba ait{' '}
            <strong>tum finansal veri</strong> (islemler, butceler, bekleyen odemeler) kalici
            olarak silinecek. Bu islem geri alinamaz.
          </>
        }
      />
    </>
  );
}
