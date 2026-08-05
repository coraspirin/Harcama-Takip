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
    const account = await user.post<{ account: { id: number } }>('/api/accounts', {
      name: 'Kategori Hesabi',
      type: 'cash',
    });
    const list = await categories(user);
    const market = list.find((c) => c.name === 'Market');
    assert.ok(market);

    await user.post('/api/transactions', {
      accountId: account.body.account.id,
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

    const account = await user.post<{ account: { id: number } }>('/api/accounts', {
      name: 'Butce Hesabi',
      type: 'cash',
    });

    await user.post('/api/transactions', {
      accountId: account.body.account.id,
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
    const account = await user.post<{ account: { id: number } }>('/api/accounts', {
      name: 'Asim Hesabi',
      type: 'cash',
    });

    await user.post('/api/transactions', {
      accountId: account.body.account.id,
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

describe('veri disa/ice aktarim', () => {
  test('export tum veriyi icerir', async () => {
    const res = await user.get<{
      schemaVersion: number;
      banks: unknown[];
      accounts: unknown[];
      categories: unknown[];
      transactions: unknown[];
      budgets: unknown[];
    }>('/api/data/export');

    assert.equal(res.status, 200);
    assert.equal(res.body.schemaVersion, 1);
    assert.ok(res.body.accounts.length > 0);
    assert.ok(res.body.categories.length > 0);
    assert.ok(res.body.transactions.length > 0);
    assert.ok(res.body.budgets.length > 0);
  });

  test('export -> reset -> import ayni veriyi geri getirir', async () => {
    const before = await user.get<Record<string, unknown[]>>('/api/data/export');

    const reset = await user.post('/api/data/reset', { confirm: 'VERIMI SIL' });
    assert.equal(reset.status, 200);

    const emptied = await user.get<Record<string, unknown[]>>('/api/data/export');
    assert.equal(emptied.body['accounts']?.length, 0);
    assert.equal(emptied.body['transactions']?.length, 0);
    // Sifirlamada varsayilan kategoriler yeniden kurulur
    assert.ok((emptied.body['categories']?.length ?? 0) > 10);

    const imported = await user.post<{ result: { transactions: number; skippedTransactions: number } }>(
      '/api/data/import',
      { mode: 'replace', data: before.body },
    );
    assert.equal(imported.status, 200);
    assert.equal(imported.body.result.skippedTransactions, 0);

    const after = await user.get<Record<string, unknown[]>>('/api/data/export');
    assert.equal(after.body['accounts']?.length, before.body['accounts']?.length);
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
    assert.ok((data.body['accounts']?.length ?? 0) > 0);
  });

  test('bozuk dosya reddedilir ve mevcut veri korunur', async () => {
    const res = await user.post<{ error: { code: string } }>('/api/data/import', {
      mode: 'replace',
      data: {
        schemaVersion: 1,
        accounts: [{ id: 1, name: 'Bozuk', type: 'gecersiz_tur', openingBalanceKurus: 0 }],
      },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');

    const data = await user.get<Record<string, unknown[]>>('/api/data/export');
    assert.ok((data.body['accounts']?.length ?? 0) > 0, 'mevcut veri silinmemeli');
  });

  test('ice aktarim BASKA kullanicinin verisine dokunmaz', async () => {
    await other.post('/api/accounts', { name: 'Mehmet Hesabi', type: 'cash' });
    const beforeOther = await other.get<Record<string, unknown[]>>('/api/data/export');

    await user.post('/api/data/import', {
      mode: 'replace',
      data: { schemaVersion: 1, accounts: [], transactions: [] },
    });

    const afterOther = await other.get<Record<string, unknown[]>>('/api/data/export');
    assert.equal(afterOther.body['accounts']?.length, beforeOther.body['accounts']?.length);
    assert.ok((afterOther.body['accounts']?.length ?? 0) > 0);
  });
});
