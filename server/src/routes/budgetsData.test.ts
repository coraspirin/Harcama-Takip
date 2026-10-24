import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let user: TestClient;
let other: TestClient;

type Category = { id: number; name: string; kind: string; archived: boolean; usageCount: number };
type Budget = {
  id: number;
  categoryId: number;
  limitKurus: number;
  spentKurus: number;
  remainingKurus: number;
  usagePercent: number;
  exceeded: boolean;
};

async function categories(client: TestClient, includeArchived = false) {
  const res = await client.get<{ categories: Category[] }>(
    `/api/categories${includeArchived ? '?includeArchived=true' : ''}`,
  );
  return res.body.categories;
}

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'ayse');
  other = await createUserAndLogin(server, 'mehmet');
});

after(async () => {
  await server.close();
});

describe('kategoriler', () => {
  test('yeni kategori olusturulur', async () => {
    const res = await user.post<{ category: Category }>('/api/categories', {
      name: 'Evcil hayvan',
      kind: 'expense',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.category.name, 'Evcil hayvan');
  });

  test('ayni isim ve turde ikinci kategori reddedilir', async () => {
    const res = await user.post('/api/categories', { name: 'Evcil hayvan', kind: 'expense' });
    assert.equal(res.status, 409);
  });

  test('ayni isim FARKLI turde kabul edilir', async () => {
    const res = await user.post('/api/categories', { name: 'Evcil hayvan', kind: 'income' });
    assert.equal(res.status, 201);
  });

  test('KULLANILMAYAN kategori silinir', async () => {
    const list = await categories(user);
    const target = list.find((c) => c.name === 'Evcil hayvan' && c.kind === 'income');
    assert.ok(target);

    const res = await user.delete<{ action: string }>(`/api/categories/${target.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.action, 'deleted');
  });

  test('KULLANIMDA olan kategori silinmez, ARSIVLENIR', async () => {
    const list = await categories(user);
    const market = list.find((c) => c.name === 'Market');
    assert.ok(market);

    await user.post('/api/transactions', {
      categoryId: market.id,
      type: 'expense',
      amountKurus: 5_000,
      date: '2026-08-05',
    });

    const res = await user.delete<{ action: string; usageCount: number }>(
      `/api/categories/${market.id}`,
    );
    assert.equal(res.body.action, 'archived');
    assert.equal(res.body.usageCount, 1);

    // Arsivli kategori varsayilan listede gorunmez ama gecmis islem korunur
    const active = await categories(user);
    assert.ok(!active.some((c) => c.id === market.id));

    const withArchived = await categories(user, true);
    assert.ok(withArchived.some((c) => c.id === market.id && c.archived));
  });

  test('baskasinin kategorisi duzenlenemez', async () => {
    const mine = (await categories(user))[0];
    assert.ok(mine);
    const res = await other.patch(`/api/categories/${mine.id}`, { name: 'Ele gecirildi' });
    assert.equal(res.status, 404);
  });
});

describe('butce', () => {
  let categoryId: number;

  before(async () => {
    const list = await categories(user);
    const yemek = list.find((c) => c.name === 'Yemek');
    assert.ok(yemek);
    categoryId = yemek.id;
  });

  test('gelir kategorisine butce belirlenemez', async () => {
    const list = await categories(user);
    const maas = list.find((c) => c.name === 'Maas');
    assert.ok(maas);

    const res = await user.post('/api/budgets', {
      categoryId: maas.id,
      yearMonth: '2026-08',
      limitKurus: 100_000,
    });
    assert.equal(res.status, 400);
  });

  test('butce olusturulur ve harcama ile birlikte doner', async () => {
    const created = await user.post<{ budget: Budget }>('/api/budgets', {
      categoryId,
      yearMonth: '2026-08',
      limitKurus: 100_000, // 1.000,00 TL
    });
    assert.equal(created.status, 201);


    await user.post('/api/transactions', {
      categoryId,
      type: 'expense',
      amountKurus: 30_000,
      date: '2026-08-10',
    });

    const res = await user.get<{ budgets: Budget[] }>('/api/budgets?month=2026-08');
    const budget = res.body.budgets.find((b) => b.categoryId === categoryId);
    assert.ok(budget);
    assert.equal(budget.spentKurus, 30_000);
    assert.equal(budget.remainingKurus, 70_000);
    assert.equal(budget.usagePercent, 30);
    assert.equal(budget.exceeded, false);
  });

  test('limit asildiginda exceeded true olur', async () => {

    await user.post('/api/transactions', {
      categoryId,
      type: 'expense',
      amountKurus: 90_000,
      date: '2026-08-20',
    });

    const res = await user.get<{ budgets: Budget[]; totals: { exceededCount: number } }>(
      '/api/budgets?month=2026-08',
    );
    const budget = res.body.budgets.find((b) => b.categoryId === categoryId);
    assert.ok(budget);
    assert.equal(budget.spentKurus, 120_000);
    assert.equal(budget.exceeded, true);
    assert.equal(budget.remainingKurus, -20_000);
    assert.equal(res.body.totals.exceededCount, 1);
  });

  test('BASKA AYIN harcamasi butceye sayilmaz', async () => {
    const res = await user.get<{ budgets: Budget[] }>('/api/budgets?month=2026-09');
    assert.equal(res.body.budgets.length, 0, 'eylul ayinda butce yok');
  });

  test('ayni kategori ve ay icin ikinci butce reddedilir', async () => {
    const res = await user.post('/api/budgets', {
      categoryId,
      yearMonth: '2026-08',
      limitKurus: 50_000,
    });
    assert.equal(res.status, 409);
  });

  test('onceki ayin butceleri kopyalanir', async () => {
    const res = await user.post<{ copied: number }>('/api/budgets/copy', { toMonth: '2026-09' });
    assert.equal(res.status, 200);
    assert.equal(res.body.copied, 1);

    const september = await user.get<{ budgets: Budget[] }>('/api/budgets?month=2026-09');
    assert.equal(september.body.budgets.length, 1);
    // Yeni ayda harcama yok
    assert.equal(september.body.budgets[0]?.spentKurus, 0);
  });

  test('kopyalama mevcut kayitlari ezmez', async () => {
    const res = await user.post<{ copied: number }>('/api/budgets/copy', { toMonth: '2026-09' });
    assert.equal(res.body.copied, 0);
  });
});

describe('genel limit ve ay durumu', () => {
  type GeneralBudget = Budget & {
    isGeneral: boolean;
    daysLeft: number;
    dailyAllowanceKurus: number | null;
    projectedSpendKurus: number;
  };

  let ev: TestClient;
  let marketId: number;
  let kiraId: number;

  before(async () => {
    ev = await createUserAndLogin(server, 'evhalki');
    const list = await categories(ev);
    marketId = list.find((c) => c.name === 'Market')!.id;
    kiraId = list.find((c) => c.name === 'Kira')!.id;

    for (const tx of [
      { categoryId: marketId, amountKurus: 200_000, date: '2026-05-10' },
      { categoryId: kiraId, amountKurus: 1_500_000, date: '2026-05-01' },
      { categoryId: null, amountKurus: 50_000, date: '2026-05-20' },
    ]) {
      await ev.post('/api/transactions', { type: 'expense', ...tx });
    }
  });

  test('genel limit TUM giderleri sayar ve ayri doner', async () => {
    const created = await ev.post('/api/budgets', { yearMonth: '2026-05', limitKurus: 2_000_000 });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    await ev.post('/api/budgets', {
      categoryId: marketId,
      yearMonth: '2026-05',
      limitKurus: 300_000,
    });

    const res = await ev.get<{
      general: GeneralBudget | null;
      budgets: GeneralBudget[];
      totals: { limitKurus: number; spentKurus: number };
    }>('/api/budgets?month=2026-05');

    assert.ok(res.body.general);
    assert.equal(res.body.general.isGeneral, true);
    // Kategorisiz gider de genel limite sayilir: 200.000 + 1.500.000 + 50.000
    assert.equal(res.body.general.spentKurus, 1_750_000);
    assert.equal(res.body.general.remainingKurus, 250_000);
    // Gecmis ay: gunluk harcanabilir yok, tahmin gercek harcama
    assert.equal(res.body.general.dailyAllowanceKurus, null);
    assert.equal(res.body.general.projectedSpendKurus, 1_750_000);

    // Kategori limitleri listede, genel limit toplamlara karismaz
    assert.equal(res.body.budgets.length, 1);
    assert.equal(res.body.totals.limitKurus, 300_000);
    assert.equal(res.body.totals.spentKurus, 200_000);
  });

  test('ayni ay icin ikinci genel limit reddedilir', async () => {
    const res = await ev.post<{ error: { message: string } }>('/api/budgets', {
      yearMonth: '2026-05',
      limitKurus: 100_000,
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /genel limit/);
  });

  test('genel limit varken onceki aydan kopyalama hepsini tasir', async () => {
    const res = await ev.post<{ copied: number }>('/api/budgets/copy', { toMonth: '2026-06' });
    assert.equal(res.body.copied, 2, 'genel limit + market limiti');

    const june = await ev.get<{ general: GeneralBudget | null; budgets: GeneralBudget[] }>(
      '/api/budgets?month=2026-06',
    );
    assert.equal(june.body.general?.limitKurus, 2_000_000);
    assert.equal(june.body.budgets.length, 1);

    const again = await ev.post<{ copied: number }>('/api/budgets/copy', { toMonth: '2026-06' });
    assert.equal(again.body.copied, 0, 'genel limit ikinci kez kopyalanmamali');
  });

  test('ay durumu: beklenen gelir, harcama, bekleyen odeme ve serbest para', async () => {
    await ev.post('/api/transactions', { type: 'income', amountKurus: 4_000_000, date: '2026-05-01' });
    await ev.post('/api/scheduled', {
      kind: 'planned',
      name: 'Okul taksiti',
      direction: 'expense',
      amountKurus: 600_000,
      startDate: '2026-05-25',
    });

    const res = await ev.get<{
      expectedIncomeKurus: number;
      incomeIsEstimate: boolean;
      spentKurus: number;
      pendingExpenseKurus: number;
      freeKurus: number;
    }>('/api/budgets/overview?month=2026-05');

    assert.equal(res.status, 200);
    assert.equal(res.body.expectedIncomeKurus, 4_000_000);
    assert.equal(res.body.incomeIsEstimate, false);
    assert.equal(res.body.spentKurus, 1_750_000);
    assert.equal(res.body.pendingExpenseKurus, 600_000);
    // 4.000.000 - 1.750.000 - 600.000
    assert.equal(res.body.freeKurus, 1_650_000);
  });

  test('gelir girilmemis ayda onceki aylarin ortalamasi kullanilir', async () => {
    const res = await ev.get<{ expectedIncomeKurus: number; incomeIsEstimate: boolean }>(
      '/api/budgets/overview?month=2026-06',
    );
    assert.equal(res.body.incomeIsEstimate, true);
    // Son 3 ayda yalnizca mayista gelir var; bos aylar ortalamayi dusurmez
    assert.equal(res.body.expectedIncomeKurus, 4_000_000);
  });

  test('baskasinin ay durumu gorunmez', async () => {
    const res = await other.get<{ spentKurus: number }>('/api/budgets/overview?month=2026-05');
    assert.equal(res.body.spentKurus, 0);
  });
});

describe('veri disa/ice aktarim', () => {
  test('export tum veriyi icerir', async () => {
    const res = await user.get<{
      schemaVersion: number;
      categories: unknown[];
      transactions: unknown[];
      budgets: unknown[];
    }>('/api/data/export');

    assert.equal(res.status, 200);
    assert.equal(res.body.schemaVersion, 2);
    assert.ok(!('accounts' in res.body), 'hesap verisi artik disa aktarilmaz');
    assert.ok(res.body.categories.length > 0);
    assert.ok(res.body.transactions.length > 0);
    assert.ok(res.body.budgets.length > 0);
  });

  test('export -> reset -> import ayni veriyi geri getirir', async () => {
    const before = await user.get<Record<string, unknown[]>>('/api/data/export');

    const reset = await user.post('/api/data/reset', { confirm: 'VERIMI SIL' });
    assert.equal(reset.status, 200);

    const emptied = await user.get<Record<string, unknown[]>>('/api/data/export');
    assert.equal(emptied.body['transactions']?.length, 0);
    // Sifirlamada varsayilan kategoriler yeniden kurulur
    assert.ok((emptied.body['categories']?.length ?? 0) > 10);

    const imported = await user.post<{ result: { transactions: number } }>('/api/data/import', {
      mode: 'replace',
      data: before.body,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.result.transactions, before.body['transactions']?.length);

    const after = await user.get<Record<string, unknown[]>>('/api/data/export');
    assert.equal(after.body['transactions']?.length, before.body['transactions']?.length);
    assert.equal(after.body['budgets']?.length, before.body['budgets']?.length);
  });

  test('reset yanlis onay kelimesiyle calismaz', async () => {
    const res = await user.post<{ error: { message: string } }>('/api/data/reset', {
      confirm: 'sil',
    });
    assert.equal(res.status, 400);

    // Veri yerinde durmali
    const data = await user.get<Record<string, unknown[]>>('/api/data/export');
    assert.ok((data.body['transactions']?.length ?? 0) > 0);
  });

  test('bozuk dosya reddedilir ve mevcut veri korunur', async () => {
    const res = await user.post<{ error: { code: string } }>('/api/data/import', {
      mode: 'replace',
      data: {
        schemaVersion: 2,
        transactions: [
          { categoryId: null, type: 'gecersiz_tur', amountKurus: 100, date: '2026-08-01', description: null },
        ],
      },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');

    const data = await user.get<Record<string, unknown[]>>('/api/data/export');
    assert.ok((data.body['transactions']?.length ?? 0) > 0, 'mevcut veri silinmemeli');
  });

  test('ice aktarim BASKA kullanicinin verisine dokunmaz', async () => {
    await other.post('/api/transactions', { type: 'expense', amountKurus: 1000, date: '2026-08-01' });
    const beforeOther = await other.get<Record<string, unknown[]>>('/api/data/export');

    await user.post('/api/data/import', {
      mode: 'replace',
      data: { schemaVersion: 2, transactions: [] },
    });

    const afterOther = await other.get<Record<string, unknown[]>>('/api/data/export');
    assert.equal(
      afterOther.body['transactions']?.length,
      beforeOther.body['transactions']?.length,
    );
    assert.ok((afterOther.body['transactions']?.length ?? 0) > 0);
  });

  test('surum 1 yedegi okunur: hesaplar yok sayilir, transferler gelir/gider olur', async () => {
    const eski = await createUserAndLogin(server, 'eskiyedek');

    const res = await eski.post<{ result: { transactions: number; categories: number } }>(
      '/api/data/import',
      {
        mode: 'replace',
        data: {
          schemaVersion: 1,
          banks: [{ id: 1, name: 'Eski Banka', monthlyInterestBp: 300, taxesIncluded: true }],
          accounts: [{ id: 1, bankId: 1, name: 'Vadesiz', type: 'bank', openingBalanceKurus: 0, archived: false }],
          categories: [{ id: 7, name: 'Market', kind: 'expense', isDefault: true, archived: false }],
          transactions: [
            { accountId: 1, categoryId: 7, type: 'expense', amountKurus: 5000, date: '2026-07-01', description: 'Market', transferGroupId: null, source: 'ocr' },
            { accountId: 1, categoryId: null, type: 'transfer_out', amountKurus: 2000, date: '2026-07-02', description: 'Nakit', transferGroupId: 'g1', source: 'manual' },
          ],
          cardStatements: [],
          budgets: [],
        },
      },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.result.transactions, 2);

    const list = await eski.get<{ transactions: { type: string; categoryName: string | null }[] }>(
      '/api/transactions',
    );
    assert.deepEqual(list.body.transactions.map((t) => t.type).sort(), ['expense', 'expense']);
    assert.ok(list.body.transactions.some((t) => t.categoryName === 'Market'));
  });
});
