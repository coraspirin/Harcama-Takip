import { useState } from 'react';
import { House, Send, Trash2 } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync.ts';
import { api, ApiError } from '../../services/api.ts';
import { Button } from '../../components/ui/Button.tsx';
import { SelectField, TextField } from '../../components/ui/Field.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { formatDateTime } from '../../lib/format.ts';

type HaSettings = {
  baseUrl: string;
  tokenPreview: string;
  notifyTarget: string | null;
  enabled: boolean;
  lastError: string | null;
  lastSuccessAt: string | null;
};

type HaTarget = { service: string; name: string };

const haService = {
  get: () => api.get<{ settings: HaSettings | null }>('/api/settings/home-assistant'),
  save: (input: {
    baseUrl: string;
    token?: string;
    notifyTarget: string | null;
    enabled: boolean;
  }) => api.put<{ saved: boolean }>('/api/settings/home-assistant', input),
  test: (input: { baseUrl: string; token?: string; notifyTarget?: string }) =>
    api.post<{ targets: HaTarget[]; testNotificationSent: boolean }>(
      '/api/settings/home-assistant/test',
      input,
    ),
  remove: () => api.delete<{ deleted: boolean }>('/api/settings/home-assistant'),
};

export default function HomeAssistantBolumu() {
  const settings = useAsync(() => haService.get(), []);

  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [notifyTarget, setNotifyTarget] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [targets, setTargets] = useState<HaTarget[]>([]);
  const [initialized, setInitialized] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Kayitli ayarlar geldiginde formu bir kez doldur
  const current = settings.data?.settings ?? null;
  if (current && !initialized) {
    setBaseUrl(current.baseUrl);
    setNotifyTarget(current.notifyTarget ?? '');
    setEnabled(current.enabled);
    setInitialized(true);
  }

  async function handleTest(withNotification: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await haService.test({
        baseUrl,
        ...(token ? { token } : {}),
        ...(withNotification && notifyTarget ? { notifyTarget } : {}),
      });
      setTargets(res.targets);
      setNotice(
        res.testNotificationSent
          ? 'Test bildirimi gonderildi. Telefonunuzu kontrol edin.'
          : `Baglanti basarili. ${res.targets.length} bildirim hedefi bulundu.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Baglanti kurulamadi');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await haService.save({
        baseUrl,
        ...(token ? { token } : {}),
        notifyTarget: notifyTarget || null,
        enabled,
      });
      setToken('');
      setNotice('Ayarlar kaydedildi.');
      await settings.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await haService.remove();
      setBaseUrl('');
      setToken('');
      setNotifyTarget('');
      setEnabled(false);
      setTargets([]);
      setInitialized(false);
      setNotice('Home Assistant baglantisi kaldirildi.');
      await settings.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaldirilamadi');
    } finally {
      setBusy(false);
    }
  }

  // Kayitli hedef listede yoksa (henuz test edilmedi) yine de secili gorunsun
  const targetOptions =
    notifyTarget && !targets.some((t) => t.service === notifyTarget)
      ? [{ service: notifyTarget, name: notifyTarget }, ...targets]
      : targets;

  return (
    <Card
      title="Home Assistant"
      description="Yaklasan odeme uyarilarini telefonunuza bildirim olarak gonderin"
    >
      <div className="space-y-4">
        <Alert tone="info">
          Bu entegrasyon <strong>istege baglidir</strong>. Kapali olsa da uyarilar uygulama
          icindeki bildirim zilinde gorunmeye devam eder — Home Assistant yalnizca ek bir
          kanaldir.
        </Alert>

        <TextField
          label="Home Assistant adresi"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://192.168.1.10:8123"
          hint="Yerel ag adresi veya alan adiniz"
        />

        <TextField
          label="Uzun omurlu erisim token'i"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={current ? `Kayitli: ${current.tokenPreview} — degistirmek icin yazin` : ''}
          autoComplete="off"
          hint={
            current
              ? 'Bos birakirsaniz mevcut token korunur.'
              : 'HA profil sayfanizin en altindaki "Uzun omurlu erisim belirteci" bolumunden olusturun.'
          }
        />

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy} onClick={() => void handleTest(false)}>
            Baglantiyi test et
          </Button>
          {notifyTarget && (
            <Button variant="secondary" loading={busy} onClick={() => void handleTest(true)}>
              <Send className="h-4 w-4" aria-hidden />
              Test bildirimi gonder
            </Button>
          )}
        </div>

        <SelectField
          label="Bildirim hedefi"
          value={notifyTarget}
          onChange={(e) => setNotifyTarget(e.target.value)}
          hint={
            targets.length === 0
              ? 'Hedefleri listelemek icin once baglantiyi test edin'
              : 'HA\'daki notify servislerinden birini secin'
          }
        >
          <option value="">Secilmedi</option>
          {targetOptions.map((target) => (
            <option key={target.service} value={target.service}>
              {target.name} ({target.service})
            </option>
          ))}
        </SelectField>

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
          />
          <span>
            <span className="font-medium text-slate-700">Bildirimleri Home Assistant'a gonder</span>
            <span className="block text-slate-500">
              Yaklasan planlanan odeme, taksit ve fatura uyarilari gunluk taramada telefonunuza
              iletilir.
            </span>
          </span>
        </label>

        {current?.lastError && (
          <Alert tone="warning" title="Son gonderim basarisiz oldu">
            {current.lastError}
          </Alert>
        )}
        {current?.lastSuccessAt && !current.lastError && (
          <p className="text-sm text-slate-500">
            Son basarili gonderim: {formatDateTime(current.lastSuccessAt)}
          </p>
        )}

        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button loading={busy} onClick={() => void handleSave()}>
            <House className="h-4 w-4" aria-hidden />
            Kaydet
          </Button>
          {current && (
            <Button variant="ghost" loading={busy} onClick={() => void handleRemove()}>
              <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
              Baglantiyi kaldir
            </Button>
          )}
        </div>

        <p className="text-xs text-slate-400">
          Erisim token'iniz sunucuda AES-256-GCM ile sifrelenerek saklanir, hicbir kayda duz
          metin yazilmaz ve bu ekranda yalnizca maskeli hali gosterilir.
        </p>
      </div>
    </Card>
  );
}
