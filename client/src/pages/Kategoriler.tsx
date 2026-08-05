import { useState } from 'react';
import { Archive, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { categoryService } from '../services/finance.ts';
import { ApiError } from '../services/api.ts';
import type { Category, CategoryKind } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { SelectField, TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.tsx';

export default function Kategoriler() {
  const [showArchived, setShowArchived] = useState(false);
  const categories = useAsync(() => categoryService.list(showArchived), [showArchived]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [archived, setArchived] = useState(false);

  function openCreate() {
    setEditing(null);
    setName('');
    setKind('expense');
    setArchived(false);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setName(category.name);
    setKind(category.kind);
    setArchived(category.archived);
    setError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      if (editing) await categoryService.update(editing.id, { name: name.trim(), archived });
      else await categoryService.create({ name: name.trim(), kind });
      setFormOpen(false);
      await categories.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await categoryService.remove(deleting.id);
      setNotice(
        res.action === 'archived'
          ? `"${deleting.name}" ${res.usageCount} islemde kullanildigi icin silinmedi, arsivlendi. Gecmis kayitlariniz korundu.`
          : `"${deleting.name}" silindi.`,
      );
      setDeleting(null);
      await categories.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  const list = categories.data ?? [];
  const expense = list.filter((c) => c.kind === 'expense');
  const income = list.filter((c) => c.kind === 'income');

  function renderGroup(title: string, items: Category[]) {
    if (items.length === 0) return null;
    return (
      <Card title={title}>
        <ul className="-my-2 divide-y divide-slate-100">
          {items.map((category) => (
            <li key={category.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className={`truncate font-medium ${category.archived ? 'text-slate-400' : 'text-slate-900'}`}>
                  {category.name}
                  {category.archived && ' (arsivli)'}
                </p>
                <p className="text-sm text-slate-500">
                  {category.usageCount === 0
                    ? 'Hic kullanilmamis'
                    : `${category.usageCount} islemde kullanilmis`}
                  {category.isDefault && ' · varsayilan'}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(category)} aria-label="Duzenle">
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleting(category)}
                  aria-label="Sil"
                >
                  <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Kategoriler"
        description="Gelir ve gider kategorileriniz"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            Kategori ekle
          </Button>
        }
      />

      {categories.error && (
        <div className="mb-4">
          <Alert tone="error">{categories.error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}

      {!categories.loading && list.length === 0 ? (
        <Card>
          <EmptyState
            icon={Tags}
            title="Kategori yok"
            description="Harcamalarinizi gruplamak icin kategori ekleyin."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                Kategori ekle
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {renderGroup('Gider kategorileri', expense)}
          {renderGroup('Gelir kategorileri', income)}
        </div>
      )}

      <div className="mt-6">
        <label className="inline-flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
          />
          <Archive className="h-4 w-4" aria-hidden />
          Arsivlenmis kategorileri de goster
        </label>
      </div>

      <Modal
        open={formOpen}
        title={editing ? 'Kategoriyi duzenle' : 'Kategori ekle'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Vazgec
            </Button>
            <Button loading={busy} onClick={() => void handleSave()}>
              Kaydet
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField
            label="Kategori adi"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />

          {!editing && (
            <SelectField
              label="Tur"
              value={kind}
              onChange={(e) => setKind(e.target.value as CategoryKind)}
              hint="Tur sonradan degistirilemez; gecmis islemlerin isareti bozulmasin diye."
            >
              <option value="expense">Gider</option>
              <option value="income">Gelir</option>
            </SelectField>
          )}

          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-slate-700">Arsivle (yeni islemlerde secilemez)</span>
            </label>
          )}

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Kategoriyi sil"
        loading={busy}
        danger={(deleting?.usageCount ?? 0) === 0}
        confirmLabel={(deleting?.usageCount ?? 0) > 0 ? 'Arsivle' : 'Evet, sil'}
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message={
          (deleting?.usageCount ?? 0) > 0 ? (
            <>
              <strong>{deleting?.name}</strong> {deleting?.usageCount} islemde kullanilmis. Gecmis
              kayitlarin kategorisi kaybolmasin diye silinmeyecek,{' '}
              <strong>arsivlenecek</strong>: yeni islemlerde secilemez, eski kayitlarda gorunmeye
              devam eder.
            </>
          ) : (
            <>
              <strong>{deleting?.name}</strong> silinecek. Bu kategori hic kullanilmamis.
            </>
          )
        }
      />
    </>
  );
}
