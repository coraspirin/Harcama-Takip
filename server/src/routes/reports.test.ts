import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let user: TestClient;
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
  const res = await user.post('/api/transactions', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
}

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'ayse');

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

describe('gidisat tahmini', () => {
  function monthsAgo(n: number): string {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());
    const [y, m] = today.split('-').map(Number) as [number, number];
    const total = y * 12 + (m - 1) - n;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  }

  type Forecast = {
    hasHistory: boolean;
    averages: { months: number; incomeKurus: number; fixedExpenseKurus: number; variableExpenseKurus: number };
    monthlyFreeCashKurus: number;
    projection: { month: string; debtKurus: number; cashKurus: number }[];
    end: { debtKurus: number; cashKurus: number };
    direction: string;
    scenario: { monthsSaved: number | null; interestSavedKurus: number | null } | null;
  };

  test('gecmis ortalamasi ileri tasinir, borc ve birikim plani dusulur', async () => {
    const tahminci = await createUserAndLogin(server, 'tahminci');
    const categories = await tahminci.get<{ categories: { id: number; name: string }[] }>(
      '/api/categories',
    );
    const kira = categories.body.categories.find((c) => c.name === 'Kira')!;
    const market = categories.body.categories.find((c) => c.name === 'Market')!;

    for (const n of [1, 2]) {
      const month = monthsAgo(n);
      await tahminci.post('/api/transactions', { type: 'income', amountKurus: 5_000_000, date: `${month}-01` });
      await tahminci.post('/api/transactions', {
        type: 'expense', categoryId: kira.id, amountKurus: 2_000_000, date: `${month}-02`,
      });
      await tahminci.post('/api/transactions', {
        type: 'expense', categoryId: market.id, amountKurus: 1_000_000, date: `${month}-10`,
      });
    }
    // Bu ayin yarim verisi ortalamaya girmemeli
    await tahminci.post('/api/transactions', {
      type: 'expense', categoryId: market.id, amountKurus: 9_000_000, date: `${monthsAgo(0)}-01`,
    });

    await tahminci.post('/api/debts', {
      kind: 'credit_card',
      name: 'Kart',
      balanceKurus: 2_000_000,
      monthlyInterestBp: 400,
      taxesIncluded: true,
      monthlyPaymentKurus: 300_000,
    });
    await tahminci.post('/api/savings', { name: 'Tatil', targetKurus: 1_000_000, monthlyPlanKurus: 200_000 });

    const res = await tahminci.get<Forecast>('/api/reports/forecast?basis=3');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.hasHistory, true);
    assert.equal(res.body.averages.months, 2);
    assert.equal(res.body.averages.incomeKurus, 5_000_000);
    assert.equal(res.body.averages.fixedExpenseKurus, 2_000_000);
    assert.equal(res.body.averages.variableExpenseKurus, 1_000_000);
    // 2.000.000 net - 300.000 kart - 200.000 birikim
    assert.equal(res.body.monthlyFreeCashKurus, 1_500_000);
    assert.equal(res.body.projection.length, 12);
    assert.ok(res.body.end.debtKurus < 2_000_000);
    assert.equal(res.body.direction, 'improving');
    assert.equal(res.body.scenario, null);

    const withCut = await tahminci.get<Forecast>('/api/reports/forecast?basis=3&cut=200000');
    assert.ok(withCut.body.scenario);
    assert.ok((withCut.body.scenario.monthsSaved ?? 0) > 0);
    assert.ok((withCut.body.scenario.interestSavedKurus ?? 0) > 0);
  });

  test('gecersiz baz ay reddedilir', async () => {
    assert.equal((await user.get('/api/reports/forecast?basis=5')).status, 400);
  });

  test('gecmis veri yoksa hasHistory false', async () => {
    const yeni = await createUserAndLogin(server, 'yenigelen');
    const res = await yeni.get<Forecast>('/api/reports/forecast');
    assert.equal(res.body.hasHistory, false);
  });
});
