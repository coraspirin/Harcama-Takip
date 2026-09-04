import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let user: TestClient;
let accountId: number;
let secondAccountId: number;
let marketId: number;
let kiraId: number;
let maasId: number;

type Breakdown = {
  categoryId: number | null;
  categoryName: string;
  totalKurus: number;
  transactionCount: number;
  sharePercent: number;
};

async function addTransaction(body: Record<string, unknown>) {
  const res = await user.post('/api/transactions', { accountId, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
}

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'ayse');

  const account = await user.post<{ account: { id: number } }>('/api/accounts', {
    name: 'Ana Hesap',
    type: 'bank',
    openingBalanceKurus: 0,
  });
  accountId = account.body.account.id;

  const second = await user.post<{ account: { id: number } }>('/api/accounts', {
    name: 'Nakit',
    type: 'cash',
  });
  secondAccountId = second.body.account.id;

  const categories = await user.get<{ categories: { id: number; name: string }[] }>(
    '/api/categories',
  );
  const find = (name: string) => {
    const found = categories.body.categories.find((c) => c.name === name);
    assert.ok(found, `${name} kategorisi olmali`);
    return found.id;
  };
  marketId = find('Market');
  kiraId = find('Kira');
  maasId = find('Maas');

  // --- 2026-06 ---
  await addTransaction({ type: 'income', categoryId: maasId, amountKurus: 500_000, date: '2026-06-01' });
  await addTransaction({ type: 'expense', categoryId: marketId, amountKurus: 100_000, date: '2026-06-10' });

  // --- 2026-07 (ay sinirlari: ilk ve son gun) ---
  await addTransaction({ type: 'income', categoryId: maasId, amountKurus: 600_000, date: '2026-07-01' });
  await addTransaction({ type: 'expense', categoryId: marketId, amountKurus: 150_000, date: '2026-07-31' });
  await addTransaction({ type: 'expense', categoryId: kiraId, amountKurus: 250_000, date: '2026-07-15' });
  // Kategorisiz gider
  await addTransaction({ type: 'expense', categoryId: null, amountKurus: 50_000, date: '2026-07-20' });

  // Hesaplar arasi hareket AYRI BIR AYDA sinanir: artik siradan gelir/gider
  // oldugu icin ayni aya konsaydi o ayin tum toplamlarini degistirirdi.
  await user.post('/api/transactions/transfer', {
    fromAccountId: accountId,
    toAccountId: secondAccountId,
    amountKurus: 999_999,
    date: '2026-09-15',
  });
});

after(async () => {
  await server.close();
});

describe('aylik rapor', () => {
  test('ay sinirlarindaki kayitlar dahil edilir', async () => {
    const res = await user.get<{
      totals: { incomeKurus: number; expenseKurus: number; netKurus: number };
    }>('/api/reports/monthly?month=2026-07');

    assert.equal(res.status, 200);
    assert.equal(res.body.totals.incomeKurus, 600_000);
    // 150.000 (ayin son gunu) + 250.000 + 50.000
    assert.equal(res.body.totals.expenseKurus, 450_000);
    assert.equal(res.body.totals.netKurus, 150_000);
  });

  test('hesaplar arasi hareket RAPORLARA GIRER', async () => {
    // Ayri bir "transfer" turu yok: cikan bacak gider, giren bacak gelir olarak
    // raporlanir. Kullanici bu ayrimin kaldirilmasina karar verdi.
    const res = await user.get<{
      totals: { incomeKurus: number; expenseKurus: number; netKurus: number };
      byAccount: { accountName: string; expenseKurus: number }[];
    }>('/api/reports/monthly?month=2026-09');

    assert.equal(res.body.totals.incomeKurus, 999_999, 'giren bacak gelir sayilmali');
    assert.equal(res.body.totals.expenseKurus, 999_999, 'cikan bacak gider sayilmali');
    assert.equal(res.body.totals.netKurus, 0, 'net etki sifir');

    assert.ok(
      res.body.byAccount.some((a) => a.accountName === 'Nakit'),
      'para giren hesap raporda gorunmeli',
    );
  });

  test('onceki aya gore degisim yuzdesi hesaplanir', async () => {
    const res = await user.get<{
      previous: { incomeChangePercent: number | null; expenseChangePercent: number | null };
    }>('/api/reports/monthly?month=2026-07');

    // Gelir 500.000 -> 600.000 = %20 artis
    assert.equal(res.body.previous.incomeChangePercent, 20);
    // Gider 100.000 -> 450.000 = %350 artis
    assert.equal(res.body.previous.expenseChangePercent, 350);
  });

  test('onceki ayda veri yoksa degisim null doner (sifira bolme yok)', async () => {
    const res = await user.get<{
      previous: { incomeChangePercent: number | null };
    }>('/api/reports/monthly?month=2026-06');

    assert.equal(res.body.previous.incomeChangePercent, null);
  });

  test('bos ayda toplamlar sifir doner', async () => {
    const res = await user.get<{
      totals: { incomeKurus: number; expenseKurus: number; netKurus: number };
      expenseByCategory: Breakdown[];
    }>('/api/reports/monthly?month=2027-03');

    assert.equal(res.body.totals.incomeKurus, 0);
    assert.equal(res.body.totals.expenseKurus, 0);
    assert.equal(res.body.totals.netKurus, 0);
    assert.equal(res.body.expenseByCategory.length, 0);
  });
});

describe('kategori kirilimi', () => {
  test('kategoriler paya gore siralanir ve yuzdeleri toplam 100 eder', async () => {
    const res = await user.get<{ totalKurus: number; categories: Breakdown[] }>(
      '/api/reports/categories?from=2026-07-01&to=2026-07-31&kind=expense',
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.totalKurus, 450_000);

    const [first, second] = res.body.categories;
    assert.equal(first?.categoryName, 'Kira');
    assert.equal(first?.totalKurus, 250_000);
    assert.equal(second?.categoryName, 'Market');

    const shareSum = res.body.categories.reduce((sum, c) => sum + c.sharePercent, 0);
    assert.ok(Math.abs(shareSum - 100) < 0.5, `paylar ~100 olmali, ${shareSum}`);
  });

  test('KATEGORISIZ kayitlar da raporda gorunur', async () => {
    const res = await user.get<{ categories: Breakdown[] }>(
      '/api/reports/categories?from=2026-07-01&to=2026-07-31&kind=expense',
    );

    const uncategorized = res.body.categories.find((c) => c.categoryId === null);
    assert.ok(uncategorized, 'kategorisiz grup olmali');
    assert.equal(uncategorized.categoryName, 'Kategorisiz');
    assert.equal(uncategorized.totalKurus, 50_000);
  });

  test('gelir kirilimi ayri istenebilir', async () => {
    const res = await user.get<{ totalKurus: number; categories: Breakdown[] }>(
      '/api/reports/categories?from=2026-07-01&to=2026-07-31&kind=income',
    );
    assert.equal(res.body.totalKurus, 600_000);
    assert.equal(res.body.categories[0]?.categoryName, 'Maas');
  });

  test('ters tarih araligi reddedilir', async () => {
    const res = await user.get('/api/reports/categories?from=2026-07-31&to=2026-07-01');
    assert.equal(res.status, 400);
  });
});

describe('aylik trend', () => {
  test('islem olmayan aylar da sifir degerle doner', async () => {
    const res = await user.get<{
      series: { month: string; incomeKurus: number; expenseKurus: number; netKurus: number }[];
    }>('/api/reports/trend?to=2026-08&months=4');

    assert.equal(res.status, 200);
    assert.equal(res.body.series.length, 4);
    assert.deepEqual(
      res.body.series.map((s) => s.month),
      ['2026-05', '2026-06', '2026-07', '2026-08'],
    );

    const may = res.body.series[0];
    assert.equal(may?.incomeKurus, 0, 'veri olmayan ay sifir donmeli, atlanmamali');

    const july = res.body.series[2];
    assert.equal(july?.incomeKurus, 600_000);
    assert.equal(july?.expenseKurus, 450_000);
    assert.equal(july?.netKurus, 150_000);
  });

  test('trend yil sinirini dogru gecer', async () => {
    const res = await user.get<{ series: { month: string }[] }>(
      '/api/reports/trend?to=2027-01&months=3',
    );
    assert.deepEqual(
      res.body.series.map((s) => s.month),
      ['2026-11', '2026-12', '2027-01'],
    );
  });
});

describe('veri izolasyonu', () => {
  test('baska kullanici bu raporlari goremez', async () => {
    const other = await createUserAndLogin(server, 'mehmet');
    const res = await other.get<{ totals: { incomeKurus: number } }>(
      '/api/reports/monthly?month=2026-07',
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.incomeKurus, 0, 'baskasinin verisi sizmamali');
  });
});
