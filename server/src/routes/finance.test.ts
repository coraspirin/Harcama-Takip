import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin, loginAdmin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let ayse: TestClient;
let mehmet: TestClient;

type Bank = { id: number; name: string; monthlyInterestBp: number; taxesIncluded: boolean };
type Account = {
  id: number;
  name: string;
  type: string;
  bankId: number | null;
  balanceKurus: number;
  transactionCount: number;
  archived: boolean;
};
type Transaction = {
  id: number;
  type: string;
  amountKurus: number;
  transferGroupId: string | null;
  accountId: number;
};

before(async () => {
  server = await bootstrap();
  ayse = await createUserAndLogin(server, 'ayse');
  mehmet = await createUserAndLogin(server, 'mehmet');
});

after(async () => {
  await server.close();
});

async function createBank(client: TestClient, name: string, bp = 311) {
  const res = await client.post<{ bank: Bank }>('/api/banks', {
    name,
    monthlyInterestBp: bp,
    taxesIncluded: true,
  });
  assert.equal(res.status, 201, `banka olusturulmali: ${JSON.stringify(res.body)}`);
  return res.body.bank;
}

async function createAccount(
  client: TestClient,
  body: Record<string, unknown>,
): Promise<Account> {
  const res = await client.post<{ account: Account }>('/api/accounts', body);
  assert.equal(res.status, 201, `hesap olusturulmali: ${JSON.stringify(res.body)}`);
  return res.body.account;
}

describe('bankalar', () => {
  test('banka olusturulur ve listelenir', async () => {
    const bank = await createBank(ayse, 'Is Bankasi', 311);
    assert.equal(bank.monthlyInterestBp, 311);
    assert.equal(bank.taxesIncluded, true);

    const list = await ayse.get<{ banks: Bank[] }>('/api/banks');
    assert.equal(list.status, 200);
    assert.ok(list.body.banks.some((b) => b.id === bank.id));
  });

  test('ayni isimde ikinci banka reddedilir', async () => {
    const res = await ayse.post<{ error: { code: string } }>('/api/banks', {
      name: 'Is Bankasi',
      monthlyInterestBp: 0,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  test('faiz orani ust siniri asilamaz', async () => {
    const res = await ayse.post('/api/banks', { name: 'Fahis Faiz', monthlyInterestBp: 20_000 });
    assert.equal(res.status, 400);
  });
});

describe('veri izolasyonu', () => {
  test('kullanici baskasinin bankasini goremez ve okuyamaz', async () => {
    const aysesBank = await createBank(ayse, 'Garanti BBVA');

    const mehmetsList = await mehmet.get<{ banks: Bank[] }>('/api/banks');
    assert.equal(mehmetsList.body.banks.length, 0, 'mehmet kendi bankasini gormeli (hic yok)');

    // Id'yi bilse bile erisemez - 403 degil 404 doner (varligi sizdirmaz)
    const impact = await mehmet.get(`/api/banks/${aysesBank.id}/impact`);
    assert.equal(impact.status, 404);

    const update = await mehmet.patch(`/api/banks/${aysesBank.id}`, {
      name: 'Ele gecirildi',
      monthlyInterestBp: 0,
    });
    assert.equal(update.status, 404);

    const remove = await mehmet.delete(`/api/banks/${aysesBank.id}`);
    assert.equal(remove.status, 404);

    // Ayse'nin bankasi hala yerinde ve degismemis
    const stillThere = await ayse.get<{ banks: Bank[] }>('/api/banks');
    assert.ok(stillThere.body.banks.some((b) => b.name === 'Garanti BBVA'));
  });

  test('kullanici baskasinin hesabina islem yazamaz', async () => {
    const aysesAccount = await createAccount(ayse, {
      name: 'Ayse Nakit',
      type: 'cash',
      openingBalanceKurus: 0,
    });

    const res = await mehmet.post<{ error: { code: string } }>('/api/transactions', {
      accountId: aysesAccount.id,
      type: 'expense',
      amountKurus: 5000,
      date: '2026-08-05',
    });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('SUPER ADMIN hicbir finansal uca erisemez', async () => {
    const admin = await loginAdmin(server);

    for (const path of [
      '/api/banks',
      '/api/accounts',
      '/api/categories',
      '/api/transactions',
      '/api/dashboard/summary',
    ]) {
      const res = await admin.get<{ error: { code: string } }>(path);
      assert.equal(res.status, 403, `${path} super admin'e kapali olmali`);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
  });
});

describe('hesaplar ve bakiye', () => {
  test('bakiye acilis bakiyesi + islemlerden hesaplanir', async () => {
    const account = await createAccount(mehmet, {
      name: 'Vadesiz TL',
      type: 'bank',
      openingBalanceKurus: 100_000, // 1.000,00 TL
    });

    await mehmet.post('/api/transactions', {
      accountId: account.id,
      type: 'income',
      amountKurus: 50_000,
      date: '2026-08-01',
      description: 'Maas',
    });
    await mehmet.post('/api/transactions', {
      accountId: account.id,
      type: 'expense',
      amountKurus: 20_000,
      date: '2026-08-02',
      description: 'Market',
    });

    const res = await mehmet.get<{ account: Account }>(`/api/accounts/${account.id}`);
    assert.equal(res.body.account.balanceKurus, 130_000);
    assert.equal(res.body.account.transactionCount, 2);
  });

  test('nakit hesap bankaya baglanamaz', async () => {
    const bank = await createBank(mehmet, 'Yapi Kredi');
    const res = await mehmet.post<{ error: { message: string } }>('/api/accounts', {
      name: 'Cuzdan',
      type: 'cash',
      bankId: bank.id,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Nakit hesap/i);
  });

  test('baskasinin bankasina hesap baglanamaz', async () => {
    const aysesBank = await createBank(ayse, 'Akbank');
    const res = await mehmet.post('/api/accounts', {
      name: 'Sizinti Hesabi',
      type: 'bank',
      bankId: aysesBank.id,
    });
    assert.equal(res.status, 404);
  });

  test('islemi olan hesap once uyari verir, force ile silinir', async () => {
    const account = await createAccount(mehmet, { name: 'Silinecek', type: 'cash' });
    await mehmet.post('/api/transactions', {
      accountId: account.id,
      type: 'expense',
      amountKurus: 1000,
      date: '2026-08-03',
    });

    const blocked = await mehmet.delete<{ error: { details: { transactionCount: number } } }>(
      `/api/accounts/${account.id}`,
    );
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.details.transactionCount, 1);

    const forced = await mehmet.delete<{ deletedTransactions: number }>(
      `/api/accounts/${account.id}?force=true`,
    );
    assert.equal(forced.status, 200);
    assert.equal(forced.body.deletedTransactions, 1);
  });
});

describe('banka silme etkisi (cascade)', () => {
  test('banka silinince bagli hesaplar ve islemleri de silinir', async () => {
    const bank = await createBank(ayse, 'Cascade Bankasi');
    const account = await createAccount(ayse, {
      name: 'Cascade Hesap',
      type: 'bank',
      bankId: bank.id,
      openingBalanceKurus: 0,
    });
    await ayse.post('/api/transactions', {
      accountId: account.id,
      type: 'expense',
      amountKurus: 7500,
      date: '2026-08-04',
    });

    const impact = await ayse.get<{ impact: { accounts: number; transactions: number } }>(
      `/api/banks/${bank.id}/impact`,
    );
    assert.equal(impact.body.impact.accounts, 1);
    assert.equal(impact.body.impact.transactions, 1);

    const deleted = await ayse.delete(`/api/banks/${bank.id}`);
    assert.equal(deleted.status, 200);

    // Hesap da gitmis olmali
    const accountAfter = await ayse.get(`/api/accounts/${account.id}`);
    assert.equal(accountAfter.status, 404);
  });
});

describe('transfer', () => {
  test('transfer iki bacak olusturur ve bakiyeleri karsilikli degistirir', async () => {
    const from = await createAccount(ayse, {
      name: 'Transfer Kaynak',
      type: 'bank',
      openingBalanceKurus: 200_000,
    });
    const to = await createAccount(ayse, {
      name: 'Transfer Hedef',
      type: 'cash',
      openingBalanceKurus: 0,
    });

    const res = await ayse.post<{ transactions: Transaction[] }>(
      '/api/transactions/transfer',
      {
        fromAccountId: from.id,
        toAccountId: to.id,
        amountKurus: 75_000,
        date: '2026-08-05',
        description: 'Nakit cekim',
      },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.transactions.length, 2);

    const fromAfter = await ayse.get<{ account: Account }>(`/api/accounts/${from.id}`);
    const toAfter = await ayse.get<{ account: Account }>(`/api/accounts/${to.id}`);
    assert.equal(fromAfter.body.account.balanceKurus, 125_000);
    assert.equal(toAfter.body.account.balanceKurus, 75_000);
  });

  test('hesaplar arasi hareket TOPLAMLARA GIRER', async () => {
    // Ayri bir "transfer" turu yok: cikan bacak gider, giren bacak gelirdir ve
    // ikisi de toplamlara katilir (kullanici karari).
    const list = await ayse.get<{
      transactions: Transaction[];
      totals: { incomeKurus: number; expenseKurus: number };
    }>('/api/transactions?from=2026-08-05&to=2026-08-05');

    assert.ok(
      list.body.transactions.every((t) => t.transferGroupId === null),
      'transfer grubu kalmamali',
    );
    assert.equal(list.body.totals.incomeKurus, 75_000);
    assert.equal(list.body.totals.expenseKurus, 75_000);
  });

  test('ayni hesaba transfer reddedilir', async () => {
    const account = await createAccount(ayse, { name: 'Tek Hesap', type: 'cash' });
    const res = await ayse.post('/api/transactions/transfer', {
      fromAccountId: account.id,
      toAccountId: account.id,
      amountKurus: 1000,
      date: '2026-08-05',
    });
    assert.equal(res.status, 400);
  });

  test('baskasinin hesabina transfer yapilamaz', async () => {
    const mine = await createAccount(mehmet, { name: 'Benim Hesap', type: 'cash' });
    const theirs = await createAccount(ayse, { name: 'Onun Hesabi', type: 'cash' });

    const res = await mehmet.post('/api/transactions/transfer', {
      fromAccountId: mine.id,
      toAccountId: theirs.id,
      amountKurus: 1000,
      date: '2026-08-05',
    });
    assert.equal(res.status, 404);
  });

  test('bir bacagi silmek digerini ETKILEMEZ', async () => {
    const from = await createAccount(mehmet, {
      name: 'Silme Kaynak',
      type: 'bank',
      openingBalanceKurus: 50_000,
    });
    const to = await createAccount(mehmet, { name: 'Silme Hedef', type: 'cash' });

    const created = await mehmet.post<{ transactions: Transaction[] }>(
      '/api/transactions/transfer',
      { fromAccountId: from.id, toAccountId: to.id, amountKurus: 10_000, date: '2026-08-06' },
    );

    const leg = created.body.transactions[0];
    assert.ok(leg);

    const removed = await mehmet.delete<{ removedRows: number }>(`/api/transactions/${leg.id}`);
    assert.equal(removed.body.removedRows, 1, 'yalnizca secilen satir silinmeli');

    const fromAfter = await mehmet.get<{ account: Account }>(`/api/accounts/${from.id}`);
    assert.equal(fromAfter.body.account.balanceKurus, 50_000, 'silinen bacagin etkisi kalkmali');

    const toAfter = await mehmet.get<{ account: Account }>(`/api/accounts/${to.id}`);
    assert.equal(toAfter.body.account.balanceKurus, 10_000, 'diger bacak yerinde durmali');
  });

  test('olusan satirlar DUZENLENEBILIR', async () => {
    const from = await createAccount(mehmet, {
      name: 'Duzenleme Kaynak',
      type: 'bank',
      openingBalanceKurus: 50_000,
    });
    const to = await createAccount(mehmet, { name: 'Duzenleme Hedef', type: 'cash' });

    const created = await mehmet.post<{ transactions: Transaction[] }>(
      '/api/transactions/transfer',
      { fromAccountId: from.id, toAccountId: to.id, amountKurus: 10_000, date: '2026-08-06' },
    );
    const leg = created.body.transactions[0];
    assert.ok(leg);

    const res = await mehmet.patch(`/api/transactions/${leg.id}`, {
      accountId: from.id,
      categoryId: null,
      type: 'expense',
      amountKurus: 999,
      date: '2026-08-06',
      description: 'Duzenlendi',
    });
    assert.equal(res.status, 200, 'artik siradan bir islem');
  });
});

describe('islem listesi ve filtreler', () => {
  test('tarih araligi, tutar ve arama filtreleri birlikte calisir', async () => {
    const account = await createAccount(ayse, {
      name: 'Filtre Hesabi',
      type: 'bank',
      openingBalanceKurus: 0,
    });

    const rows = [
      { amountKurus: 10_000, date: '2026-09-01', description: 'Kahve' },
      { amountKurus: 50_000, date: '2026-09-15', description: 'Market alisverisi' },
      { amountKurus: 90_000, date: '2026-10-01', description: 'Market buyuk alisveris' },
    ];
    for (const row of rows) {
      await ayse.post('/api/transactions', { accountId: account.id, type: 'expense', ...row });
    }

    const byDate = await ayse.get<{ transactions: Transaction[] }>(
      `/api/transactions?accountId=${account.id}&from=2026-09-01&to=2026-09-30`,
    );
    assert.equal(byDate.body.transactions.length, 2);

    const byAmount = await ayse.get<{ transactions: Transaction[] }>(
      `/api/transactions?accountId=${account.id}&minAmountKurus=40000&maxAmountKurus=60000`,
    );
    assert.equal(byAmount.body.transactions.length, 1);

    const bySearch = await ayse.get<{ transactions: Transaction[] }>(
      `/api/transactions?accountId=${account.id}&search=Market`,
    );
    assert.equal(bySearch.body.transactions.length, 2);

    const totals = await ayse.get<{ totals: { expenseKurus: number } }>(
      `/api/transactions?accountId=${account.id}`,
    );
    assert.equal(totals.body.totals.expenseKurus, 150_000);
  });

  test('gecersiz tarih araligi reddedilir', async () => {
    const res = await ayse.get('/api/transactions?from=2026-09-30&to=2026-09-01');
    assert.equal(res.status, 400);
  });

  test('LIKE joker karakterleri arama metninde literal islenir', async () => {
    const account = await createAccount(ayse, { name: 'Joker Hesabi', type: 'cash' });
    await ayse.post('/api/transactions', {
      accountId: account.id,
      type: 'expense',
      amountKurus: 1000,
      date: '2026-09-01',
      description: 'indirim %50',
    });

    // "%" tek basina her seyi eslestirmemeli
    const res = await ayse.get<{ transactions: Transaction[] }>(
      `/api/transactions?accountId=${account.id}&search=%25`,
    );
    assert.equal(res.body.transactions.length, 1);
  });
});

describe('varsayilan kategoriler', () => {
  test('yeni kullanicida varsayilan kategoriler hazir gelir', async () => {
    const res = await ayse.get<{ categories: { name: string; kind: string }[] }>(
      '/api/categories',
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.categories.length > 10);
    assert.ok(res.body.categories.some((c) => c.name === 'Market' && c.kind === 'expense'));
    assert.ok(res.body.categories.some((c) => c.name === 'Maas' && c.kind === 'income'));
  });

  test('baskasinin kategorisi islemde kullanilamaz', async () => {
    const aysesCategories = await ayse.get<{ categories: { id: number }[] }>('/api/categories');
    const categoryId = aysesCategories.body.categories[0]?.id;
    assert.ok(categoryId);

    const account = await createAccount(mehmet, { name: 'Kategori Testi', type: 'cash' });
    const res = await mehmet.post('/api/transactions', {
      accountId: account.id,
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

    const account = await createAccount(zeynep, {
      name: 'Dashboard Hesabi',
      type: 'bank',
      openingBalanceKurus: 0,
    });

    await zeynep.post('/api/transactions', {
      accountId: account.id,
      type: 'income',
      amountKurus: 100_000,
      date: '2026-11-10',
    });
    await zeynep.post('/api/transactions', {
      accountId: account.id,
      type: 'expense',
      amountKurus: 40_000,
      date: '2026-11-12',
    });
    await zeynep.post('/api/transactions', {
      accountId: account.id,
      type: 'expense',
      amountKurus: 20_000,
      date: '2026-10-12',
    });

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
});
