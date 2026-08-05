import { useRef, useState } from 'react';
import { Check, FileText, FileUp, ScanLine, Trash2, Upload, X } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { accountService, categoryService } from '../services/finance.ts';
import { ocrService, type OcrDraftLine } from '../services/ocr.ts';
import { ApiError } from '../services/api.ts';
import { Button } from '../components/ui/Button.tsx';
import { SelectField, TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.tsx';
import { MoneyInput } from '../components/MoneyInput.tsx';
import { Money } from '../components/Money.tsx';
import { formatDate, formatDateTime } from '../lib/format.ts';

export default function IceAktar() {
  const accounts = useAsync(() => accountService.list(), []);
  const categories = useAsync(() => categoryService.list(), []);
  const parsers = useAsync(() => ocrService.parsers(), []);
  const imports = useAsync(() => ocrService.imports(), []);

  const fileInput = useRef<HTMLInputElement>(null);

  const [accountId, setAccountId] = useState<number | null>(null);
  const [parserId, setParserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [openImportId, setOpenImportId] = useState<number | null>(null);
  const [editingLine, setEditingLine] = useState<OcrDraftLine | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const detail = useAsync(
    () =>
      openImportId === null
        ? Promise.resolve(null)
        : ocrService.detail(openImportId).then((r) => r),
    [openImportId],
  );

  // --- satir duzenleme formu ---
  const [lineDate, setLineDate] = useState('');
  const [lineDescription, setLineDescription] = useState('');
  const [lineAmount, setLineAmount] = useState<number | null>(null);
  const [lineType, setLineType] = useState<'income' | 'expense'>('expense');
  const [lineCategoryId, setLineCategoryId] = useState<number | null>(null);

  async function handleUpload(file: File) {
    if (accountId === null) {
      setError('Once ekstrenin isleneceei hesabi secin');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await ocrService.upload(file, accountId, parserId || undefined);
      setNotice(
        `${result.parserName} olarak okundu · ${result.pageCount} sayfa · ${result.lineCount} satir bulundu` +
          (result.duplicateCount > 0 ? ` (${result.duplicateCount} mukerrer)` : '') +
          (result.extraction === 'ocr' ? ' · taranmis PDF, OCR kullanildi' : ''),
      );
      setOpenImportId(result.importId);
      await imports.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ekstre yuklenemedi');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function openLineEditor(line: OcrDraftLine) {
    setEditingLine(line);
    setLineDate(line.date);
    setLineDescription(line.description);
    setLineAmount(line.amountKurus);
    setLineType(line.type);
    setLineCategoryId(line.categoryId);
  }

  async function saveLine(excluded?: boolean) {
    if (!editingLine || lineAmount === null) return;
    setBusy(true);
    setError(null);
    try {
      await ocrService.updateLine(editingLine.id, {
        date: lineDate,
        description: lineDescription.trim(),
        amountKurus: lineAmount,
        type: lineType,
        categoryId: lineCategoryId,
        excluded: excluded ?? editingLine.excluded,
      });
      setEditingLine(null);
      await detail.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function toggleExcluded(line: OcrDraftLine) {
    setBusy(true);
    try {
      await ocrService.updateLine(line.id, {
        date: line.date,
        description: line.description,
        amountKurus: line.amountKurus,
        type: line.type,
        categoryId: line.categoryId,
        excluded: !line.excluded,
      });
      await detail.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Guncellenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (openImportId === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ocrService.apply(openImportId);
      setNotice(
        `${res.result.created} islem hesabiniza islendi` +
          (res.result.skipped > 0 ? `, ${res.result.skipped} satir atlandi.` : '.'),
      );
      setOpenImportId(null);
      await imports.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Islenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (deleting === null) return;
    setBusy(true);
    try {
      const res = await ocrService.remove(deleting);
      setNotice(
        res.discarded
          ? 'Ice aktarim gecmisten kaldirildi. Daha once islenen islemler hesabinizda kaldi.'
          : 'Taslak silindi.',
      );
      if (openImportId === deleting) setOpenImportId(null);
      setDeleting(null);
      await imports.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  const lines = detail.data?.lines ?? [];
  const current = detail.data?.import;
  const includedCount = lines.filter((l) => !l.excluded).length;
  const includedTotal = lines
    .filter((l) => !l.excluded)
    .reduce((sum, l) => sum + (l.type === 'expense' ? -l.amountKurus : l.amountKurus), 0);

  return (
    <>
      <PageHeader
        title="Ice aktar"
        description="Banka ekstresi veya hesap hareketi PDF'ini yukleyip islemleri toplu ekleyin"
      />

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      <Card title="Ekstre yukle" className="mb-6">
        <div className="space-y-4">
          <Alert tone="info">
            Yuklenen ekstre once <strong>taslak</strong> olarak gosterilir. Satirlari
            duzenleyip onaylayana kadar hesabinizda hicbir degisiklik olmaz.
          </Alert>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Islenecek hesap"
              value={accountId ?? ''}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}
              required
            >
              <option value="">Secin</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Banka bicimi"
              value={parserId}
              onChange={(e) => setParserId(e.target.value)}
              hint="Bos birakirsaniz dosyadan otomatik tespit edilir"
            >
              <option value="">Otomatik tespit</option>
              {(parsers.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
          </div>

          <div>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy || accountId === null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700 disabled:opacity-60"
            />
            <p className="mt-1.5 text-sm text-slate-500">
              PDF, en fazla 15 MB. Metin katmani olan ekstreler dogrudan okunur; taranmis
              belgelerde OCR devreye girer (daha yavas).
            </p>
          </div>
        </div>
      </Card>

      {/* --- Taslak --- */}
      {openImportId !== null && current && (
        <Card
          title={`Taslak: ${current.filename}`}
          description={`${current.lineCount} satir · ${includedCount} tanesi islenecek${
            current.extraction === 'ocr' ? ' · OCR ile okundu' : ''
          }`}
          className="mb-6"
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={() => setOpenImportId(null)}>
                <X className="h-4 w-4" aria-hidden />
                Kapat
              </Button>
              {current.status === 'draft' && (
                <Button size="sm" loading={busy} onClick={() => void applyImport()}>
                  <Check className="h-4 w-4" aria-hidden />
                  {includedCount} islemi kaydet
                </Button>
              )}
            </>
          }
        >
          {current.duplicateCount > 0 && (
            <div className="mb-4">
              <Alert tone="warning" title={`${current.duplicateCount} mukerrer satir bulundu`}>
                Bu satirlarla ayni tarih, tutar ve aciklamaya sahip islemler zaten kayitli.
                Varsayilan olarak <strong>haric tutuldular</strong>; yine de eklemek isterseniz
                satirin yanindaki isareti kaldirin.
              </Alert>
            </div>
          )}

          {lines.length === 0 ? (
            <EmptyState
              icon={ScanLine}
              title="Ayristirilabilir satir bulunamadi"
              description="Bu ekstre bicimi taninmamis olabilir. Banka bicimini elle secip tekrar deneyin."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 font-medium">Islensin</th>
                      <th className="pb-2 font-medium">Tarih</th>
                      <th className="pb-2 font-medium">Aciklama</th>
                      <th className="pb-2 text-right font-medium">Tutar</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((line) => (
                      <tr key={line.id} className={line.excluded ? 'opacity-50' : ''}>
                        <td className="py-2.5">
                          <input
                            type="checkbox"
                            checked={!line.excluded}
                            disabled={busy || current.status !== 'draft'}
                            onChange={() => void toggleExcluded(line)}
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                            aria-label="Bu satiri isle"
                          />
                        </td>
                        <td className="whitespace-nowrap py-2.5 text-slate-700">
                          {formatDate(line.date)}
                        </td>
                        <td className="py-2.5">
                          <span className="text-slate-900">{line.description}</span>
                          {line.isDuplicate && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              mukerrer
                            </span>
                          )}
                        </td>
                        <td
                          className={`tabular whitespace-nowrap py-2.5 text-right font-medium ${
                            line.type === 'expense' ? 'text-red-600' : 'text-emerald-600'
                          }`}
                        >
                          {line.type === 'expense' ? '−' : '+'}
                          <Money kurus={line.amountKurus} />
                        </td>
                        <td className="py-2.5 text-right">
                          {current.status === 'draft' && (
                            <Button size="sm" variant="ghost" onClick={() => openLineEditor(line)}>
                              Duzenle
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-500">
                  Islenecek net etki:{' '}
                  <span className="font-medium">
                    <Money kurus={includedTotal} signed />
                  </span>
                </span>
              </div>
            </>
          )}
        </Card>
      )}

      {/* --- Gecmis --- */}
      <Card title="Ice aktarim gecmisi">
        {!imports.loading && (imports.data ?? []).length === 0 ? (
          <EmptyState
            icon={FileUp}
            title="Henuz ekstre yuklenmemis"
            description="Yukaridan bir PDF secerek baslayin."
          />
        ) : (
          <ul className="-my-2 divide-y divide-slate-100">
            {(imports.data ?? []).map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpenImportId(item.id)}>
                  <p className="truncate font-medium text-slate-900">{item.filename}</p>
                  <p className="truncate text-sm text-slate-500">
                    {formatDateTime(item.createdAt)} · {item.accountName} · {item.lineCount} satir
                    {item.extraction === 'ocr' && ' · OCR'}
                  </p>
                </button>

                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    item.status === 'applied'
                      ? 'bg-emerald-100 text-emerald-800'
                      : item.status === 'draft'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {item.status === 'applied'
                    ? 'islendi'
                    : item.status === 'draft'
                      ? 'taslak'
                      : 'iptal'}
                </span>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleting(item.id)}
                  aria-label="Sil"
                >
                  <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* --- Satir duzenleme --- */}
      <Modal
        open={editingLine !== null}
        title="Satiri duzenle"
        onClose={() => setEditingLine(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingLine(null)}>
              Vazgec
            </Button>
            <Button loading={busy} onClick={() => void saveLine()}>
              Kaydet
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {editingLine?.raw && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="mb-1 text-xs font-medium text-slate-500">Ekstredeki ham satir</p>
              <code className="block break-all font-mono text-xs text-slate-600">
                {editingLine.raw}
              </code>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setLineType('expense')}
              className={`rounded-lg py-2 text-sm font-medium ring-1 ring-inset transition-colors ${
                lineType === 'expense'
                  ? 'bg-red-50 text-red-700 ring-red-300'
                  : 'bg-white text-slate-600 ring-slate-300'
              }`}
            >
              Gider
            </button>
            <button
              type="button"
              onClick={() => setLineType('income')}
              className={`rounded-lg py-2 text-sm font-medium ring-1 ring-inset transition-colors ${
                lineType === 'income'
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-300'
                  : 'bg-white text-slate-600 ring-slate-300'
              }`}
            >
              Gelir
            </button>
          </div>

          <TextField
            label="Tarih"
            type="date"
            value={lineDate}
            onChange={(e) => setLineDate(e.target.value)}
          />
          <TextField
            label="Aciklama"
            value={lineDescription}
            onChange={(e) => setLineDescription(e.target.value)}
          />
          <MoneyInput label="Tutar" valueKurus={lineAmount} onChangeKurus={setLineAmount} />

          <SelectField
            label="Kategori"
            value={lineCategoryId ?? ''}
            onChange={(e) => setLineCategoryId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Kategorisiz</option>
            {(categories.data ?? [])
              .filter((c) => c.kind === lineType)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </SelectField>

          <Button variant="ghost" className="w-full" onClick={() => void saveLine(true)}>
            <X className="h-4 w-4" aria-hidden />
            Bu satiri islemeden cikar
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Ice aktarimi sil"
        loading={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message="Taslak ise satirlariyla birlikte silinir. Daha once islenmis bir ice aktarim ise yalnizca gecmisten kaldirilir; olusan islemler hesabinizda kalir."
      />

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <Upload className="h-3.5 w-3.5" aria-hidden />
        Ayni dosya iki kez yuklenemez; mukerrer islem olusmasi engellenir.
      </div>
    </>
  );
}
