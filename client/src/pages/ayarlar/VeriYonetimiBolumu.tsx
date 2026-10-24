import { useRef, useState } from 'react';
import { Download, Upload, AlertTriangle } from 'lucide-react';
import { dataService } from '../../services/finance.ts';
import { ApiError } from '../../services/api.ts';
import type { ImportResult } from '../../types/index.ts';
import { Button } from '../../components/ui/Button.tsx';
import { SelectField, TextField } from '../../components/ui/Field.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Modal } from '../../components/ui/Modal.tsx';

const RESET_CONFIRMATION = 'VERIMI SIL';
/** Sunucu 2 MB'lik govde siniri uyguluyor; kullaniciyi once burada uyariyoruz. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export default function VeriYonetimiBolumu() {
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [pendingData, setPendingData] = useState<unknown | null>(null);
  const [pendingName, setPendingName] = useState('');

  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const data = await dataService.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `harcama-takip-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disa aktarilamadi');
    } finally {
      setBusy(false);
    }
  }

  async function handleFileSelected(file: File) {
    setError(null);
    setResult(null);

    if (file.size > MAX_IMPORT_BYTES) {
      setError('Dosya cok buyuk (en fazla 2 MB).');
      return;
    }

    try {
      const parsed: unknown = JSON.parse(await file.text());
      setPendingData(parsed);
      setPendingName(file.name);
    } catch {
      setError('Dosya gecerli bir JSON degil.');
    }
  }

  async function handleImport() {
    if (pendingData === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await dataService.importAll(importMode, pendingData);
      setResult(res.result);
      setPendingData(null);
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ice aktarilamadi');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    setError(null);
    try {
      await dataService.reset(resetText);
      setResetOpen(false);
      setResetText('');
      // Bakiyeler ve listeler tazelensin
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sifirlanamadi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        title="Veri yonetimi"
        description="Verinizi yedekleyin, geri yukleyin veya tamamen silin"
      >
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm text-slate-600">
              Kategorileriniz, islemleriniz ve butceleriniz tek bir JSON dosyasina aktarilir.
              Bekleyen odemeler yedege dahil degildir.
            </p>
            <Button variant="secondary" loading={busy} onClick={() => void handleExport()}>
              <Download className="h-4 w-4" aria-hidden />
              Verilerimi indir
            </Button>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <p className="mb-2 text-sm text-slate-600">
              Daha once indirdiginiz bir yedek dosyasini geri yukleyin.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileSelected(file);
              }}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </div>

          {result && (
            <Alert tone="success" title="Ice aktarim tamamlandi">
              {result.categories} kategori, {result.transactions} islem, {result.budgets} butce
              eklendi.
            </Alert>
          )}

          <div className="border-t border-slate-100 pt-5">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-red-700">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Tehlikeli bolge
            </p>
            <p className="mb-3 text-sm text-slate-600">
              Tum finansal verinizi kalici olarak siler. Hesabiniz ve giris bilgileriniz kalir,
              varsayilan kategoriler yeniden olusturulur. <strong>Once yedek alin.</strong>
            </p>
            <Button variant="danger" onClick={() => setResetOpen(true)}>
              Tum verimi sifirla
            </Button>
          </div>

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Card>

      {/* --- Ice aktarim modu onayi --- */}
      <Modal
        open={pendingData !== null}
        title="Ice aktarim"
        onClose={() => setPendingData(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingData(null)}>
              Vazgec
            </Button>
            <Button
              variant={importMode === 'replace' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => void handleImport()}
            >
              <Upload className="h-4 w-4" aria-hidden />
              Ice aktar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Dosya: <strong>{pendingName}</strong>
          </p>

          <SelectField
            label="Ice aktarim modu"
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
          >
            <option value="merge">Birlestir — mevcut veriler korunur</option>
            <option value="replace">Uzerine yaz — mevcut veriler silinir</option>
          </SelectField>

          {importMode === 'merge' ? (
            <Alert tone="info">
              Dosyadaki kayitlar mevcut verinizin uzerine eklenir. Ayni isimli kategoriler yeniden
              olusturulmaz, mevcut olanlar kullanilir.
            </Alert>
          ) : (
            <Alert tone="warning" title="Mevcut veriniz silinecek">
              Bu modda tum islemleriniz, kategorileriniz, butceleriniz ve bekleyen odemeleriniz
              silinip dosyadaki hâliyle kurulur. Bu islem geri alinamaz.
            </Alert>
          )}
        </div>
      </Modal>

      {/* --- Sifirlama onayi --- */}
      <Modal
        open={resetOpen}
        title="Tum verimi sifirla"
        onClose={() => {
          setResetOpen(false);
          setResetText('');
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setResetOpen(false);
                setResetText('');
              }}
            >
              Vazgec
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={resetText !== RESET_CONFIRMATION}
              onClick={() => void handleReset()}
            >
              Verimi sil
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="error" title="Bu islem geri alinamaz">
            Tum islemleriniz, kategorileriniz, butceleriniz ve bekleyen odemeleriniz kalici olarak
            silinecek.
          </Alert>

          <TextField
            label={`Onaylamak icin "${RESET_CONFIRMATION}" yazin`}
            value={resetText}
            onChange={(e) => setResetText(e.target.value)}
            autoComplete="off"
            autoFocus
          />

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>
    </>
  );
}
