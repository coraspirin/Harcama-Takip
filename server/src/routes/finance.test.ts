import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin, loginAdmin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let ayse: TestClient;
let mehmet: TestClient;

type Transaction = {
  id: number;
  type: string;
  amountKurus: number;
  categoryId: number | null;
  description: string | null;
};

type Category = { id: number; name: string; kind: string; nature: string };

before(async () => {
  server = await bootstrap();
  ayse = await createUserAndLogin(server, 'ayse');
  mehmet = await createUserAndLogin(server, 'mehmet');
});

after(async () => {
  await server.close();
});

async function createTransaction(
  client: TestClient,
  body: Record<string, unknown>,
): Promise<Transaction> {
  const res = await client.post<{ transaction: Transaction }>('/api/transactions', body);
  assert.equal(res.status, 201, `islem olusturulmali: ${JSON.stringify(res.body)}`);
  return res.body.transaction;
}

describe('islemler', () => {
  test('islem hesapsiz olusturulur, duzenlenir ve silinir', async () => {
    const created = await createTransaction(ayse, {
      type: 'expense',
      amountKurus: 12_500,
      date: '2026-08-05',
      description: 'Market',
    });
    assert.equal(created.amountKurus, 12_500);
    assert.ok(!('accountId' in created), 'islemde hesap alani kalmamali');

    const updated = await ayse.patch<{ transaction: Transaction }>(
      `/api/transactions/${created.id}`,
      { type: 'expense', amountKurus: 15_000, date: '2026-08-05', description: 'Market (duzeltildi)' },
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.transaction.amountKurus, 15_000);

    const removed = await ayse.delete<{ removedRows: number }>(`/api/transactions/${created.id}`);
    assert.equal(removed.body.removedRows, 1);
  });

  test('toplu silme yalnizca kendi kayitlarini siler', async () => {
    const mine = await createTransaction(mehmet, {
      type: 'expense',
      amountKurus: 1000,
      date: '2026-08-06',
    });
    const theirs = await createTransaction(ayse, {
      type: 'expense',
      amountKurus: 2000,
      date: '2026-08-06',
    });

    const res = await mehmet.post<{ removedRows: number }>('/api/transactions/bulk-delete', {
      ids: [mine.id, theirs.id],
    });
    assert.equal(res.body.removedRows, 1);

    const stillThere = await ayse.get(`/api/transactions?from=2026-08-06&to=2026-08-06`);
    assert.equal((stillThere.body as { transactions: Transaction[] }).transactions.length, 1);
  });

  test('kaldirilan hesap/banka/ekstre/OCR uclari artik yok', async () => {
    for (const path of ['/api/accounts', '/api/banks', '/api/statements', '/api/ocr/imports']) {
      assert.equal((await ayse.get(path)).status, 404, `${path} kaldirilmis olmali`);
    }
  });
});

describe('veri izolasyonu', () => {
  test('kullanici baskasinin islemini goremez, duzenleyemez, silemez', async () => {
    const aysesTx = await createTransaction(ayse, {
      type: 'expense',
      amountKurus: 5000,
      date: '2026-08-07',
      description: 'Ayse gizli',
    });

    const list = await mehmet.get<{ transactions: Transaction[] }>('/api/transactions');
    assert.ok(!list.body.transactions.some((t) => t.id === aysesTx.id));

    // Id'yi bilse bile erisemez - 403 degil 404 doner (varligi sizdirmaz)
    const update = await mehmet.patch(`/api/transactions/${aysesTx.id}`, {
      type: 'expense',
      amountKurus: 1,
      date: '2026-08-07',
    });
    assert.equal(update.status, 404);

    const remove = await mehmet.delete(`/api/transactions/${aysesTx.id}`);
    assert.equal(remove.status, 404);
  });

  test('SUPER ADMIN hicbir finansal uca erisemez', async () => {
    const admin = await loginAdmin(server);

    for (const path of ['/api/categories', '/api/transactions', '/api/dashboard/summary']) {
      const res = await admin.get<{ error: { code: string } }>(path);
      assert.equal(res.status, 403, `${path} super admin'e kapali olmali`);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
  });
});

describe('islem listesi ve filtreler', () => {
  test('tarih araligi, tutar ve arama filtreleri birlikte calisir', async () => {
    const filtreci = await createUserAndLogin(server, 'filtreci');

    const rows = [
      { amountKurus: 10_000, date: '2026-09-01', description: 'Kahve' },
      { amountKurus: 50_000, date: '2026-09-15', description: 'Market alisverisi' },
      { amountKurus: 90_000, date: '2026-10-01', description: 'Market buyuk alisveris' },
    ];
    for (const row of rows) {
      await createTransaction(filtreci, { type: 'expense', ...row });
    }

    const byDate = await filtreci.get<{ transactions: Transaction[] }>(
      '/api/transactions?from=2026-09-01&to=2026-09-30',
    );
    assert.equal(byDate.body.transactions.length, 2);

    const byAmount = await filtreci.get<{ transactions: Transaction[] }>(
      '/api/transactions?minAmountKurus=40000&maxAmountKurus=60000',
    );
    assert.equal(byAmount.body.transactions.length, 1);

    const bySearch = await filtreci.get<{ transactions: Transaction[] }>(
      '/api/transactions?search=Market',
    );
    assert.equal(bySearch.body.transactions.length, 2);

    const totals = await filtreci.get<{ totals: { expenseKurus: number } }>('/api/transactions');
    assert.equal(totals.body.totals.expenseKurus, 150_000);
  });

  test('gecersiz tarih araligi reddedilir', async () => {
    const res = await ayse.get('/api/transactions?from=2026-09-30&to=2026-09-01');
    assert.equal(res.status, 400);
  });

  test('LIKE joker karakterleri arama metninde literal islenir', async () => {
    const joker = await createUserAndLogin(server, 'joker');
    await createTransaction(joker, {
      type: 'expense',
      amountKurus: 1000,
      date: '2026-09-01',
      description: 'indirim %50',
    });
    await createTransaction(joker, {
      type: 'expense',
      amountKurus: 1000,
      date: '2026-09-01',
      description: 'indirimsiz',
    });

    // "%" tek basina her seyi eslestirmemeli
    const res = await joker.get<{ transactions: Transaction[] }>('/api/transactions?search=%25');
    assert.equal(res.body.transactions.length, 1);
  });
});

describe('kategoriler', () => {
  test('yeni kullanicida varsayilan kategoriler sabit/degisken bilgisiyle gelir', async () => {
    const res = await ayse.get<{ categories: Category[] }>('/api/categories');
    assert.equal(res.status, 200);
    assert.ok(res.body.categories.length > 10);
    assert.ok(res.body.categories.some((c) => c.name === 'Market' && c.nature === 'variable'));
    assert.ok(res.body.categories.some((c) => c.name === 'Kira' && c.nature === 'fixed'));
    assert.ok(res.body.categories.some((c) => c.name === 'Maas' && c.kind === 'income'));
  });

  test('kategori sabit/degisken olarak olusturulur ve degistirilir', async () => {
    const created = await ayse.post<{ category: Category }>('/api/categories', {
      name: 'Spor salonu',
      kind: 'expense',
      nature: 'fixed',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.category.nature, 'fixed');

    // nature gonderilmezse mevcut deger korunur
    const renamed = await ayse.patch<{ category: Category }>(
      `/api/categories/${created.body.category.id}`,
      { name: 'Spor' },
    );
    assert.equal(renamed.body.category.nature, 'fixed');

    const changed = await ayse.patch<{ category: Category }>(
      `/api/categories/${created.body.category.id}`,
      { name: 'Spor', nature: 'variable' },
    );
    assert.equal(changed.body.category.nature, 'variable');
  });

  test('baskasinin kategorisi islemde kullanilamaz', async () => {
    const aysesCategories = await ayse.get<{ categories: { id: number }[] }>('/api/categories');
    const categoryId = aysesCategories.body.categories[0]?.id;
    assert.ok(categoryId);

    const res = await mehmet.post('/api/transactions', {
      categoryId,
      type: 'expense',
      amountKurus: 1000,
      date: '2026-09-01',
    });

    // Mehmet'in kendi kategorileri var; Ayse'nin id'si ona ait degil
    assert.equal(res.status, 404);
  });
});

describe('dashboard ozeti', () => {
  test('aylik gelir/gider ve onceki aya gore degisim doner', async () => {
    // Diger testlerin kayitlarindan etkilenmemesi icin temiz bir kullanici
    const zeynep = await createUserAndLogin(server, 'zeynep');

    await createTransaction(zeynep, { type: 'income', amountKurus: 100_000, date: '2026-11-10' });
    await createTransaction(zeynep, { type: 'expense', amountKurus: 40_000, date: '2026-11-12' });
    await createTransaction(zeynep, { type: 'expense', amountKurus: 20_000, date: '2026-10-12' });

    const res = await zeynep.get<{
      totals: { incomeKurus: number; expenseKurus: number; netKurus: number };
      previousMonth: { expenseChangePercent: number | null };
    }>('/api/dashboard/summary?month=2026-11');

    assert.equal(res.status, 200);
    assert.equal(res.body.totals.incomeKurus, 100_000);
    assert.equal(res.body.totals.expenseKurus, 40_000);
    assert.equal(res.body.totals.netKurus, 60_000);
    // Onceki ay 20.000 gider -> 40.000: %100 artis
    assert.equal(res.body.previousMonth.expenseChangePercent, 100);
  });

  test('genel limit, ay durumu ve borc ozeti ozette gelir', async () => {
    const ozetci = await createUserAndLogin(server, 'ozetekrani');

    await createTransaction(ozetci, { type: 'income', amountKurus: 300_000, date: '2026-11-01' });
    await createTransaction(ozetci, { type: 'expense', amountKurus: 60_000, date: '2026-11-03' });
    await ozetci.post('/api/budgets', { yearMonth: '2026-11', limitKurus: 150_000 });
    await ozetci.post('/api/debts', {
      kind: 'loan',
      name: 'Kredi',
      balanceKurus: 500_000,
      monthlyPaymentKurus: 100_000,
    });

    const res = await ozetci.get<{
      limit: { limitKurus: number; spentKurus: number; remainingKurus: number } | null;
      overview: { expectedIncomeKurus: number; freeKurus: number };
      debts: { oweKurus: number; monthlyPaymentKurus: number; debtFreeMonth: string | null };
    }>('/api/dashboard/summary?month=2026-11');

    assert.equal(res.status, 200);
    assert.equal(res.body.limit?.spentKurus, 60_000);
    assert.equal(res.body.limit?.remainingKurus, 90_000);
    assert.equal(res.body.overview.expectedIncomeKurus, 300_000);
    assert.equal(res.body.overview.freeKurus, 240_000);
    assert.equal(res.body.debts.oweKurus, 500_000);
    assert.equal(res.body.debts.monthlyPaymentKurus, 100_000);
    assert.ok(res.body.debts.debtFreeMonth, 'borcsuz kalma ayi hesaplanmali');
  });

  test('genel limit yoksa limit null doner', async () => {
    const limitsiz = await createUserAndLogin(server, 'limitsiz');
    const res = await limitsiz.get<{ limit: unknown }>('/api/dashboard/summary');
    assert.equal(res.body.limit, null);
  });
});
