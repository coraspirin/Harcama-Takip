import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

/**
 * Hesap arasi transfer AYRIMI KALDIRILDI: her hareket siradan bir gelir veya
 * giderdir ve toplamlara katilir. Bu dosya artik o kararin korunmasini ve
 * toplu silmeyi dogrular.
 */

let server: TestServer;
let user: TestClient;
let other: TestClient;

let bankId: number;
let cardId: number;
let ikinciBankId: number;

async function createAccount(client: TestClient, name: string, type: string): Promise<number> {
  const res = await client.post<{ account: { id: number } }>('/api/accounts', {
    name,
    type,
    openingBalanceKurus: 0,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.account.id;
}

async function addTransaction(
  client: TestClient,
  accountId: number,
  type: 'income' | 'expense',
  amountKurus: number,
  date: string,
  description: string,
): Promise<number> {
  const res = await client.post<{ transaction: { id: number } }>('/api/transactions', {
    accountId,
    categoryId: null,
    type,
    amountKurus,
    date,
    description,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.transaction.id;
}

async function monthlyTotals(client: TestClient, month: string) {
  const res = await client.get<{
    totals: { incomeKurus: number; expenseKurus: number };
  }>(`/api/reports/monthly?month=${month}`);
  assert.equal(res.status, 200);
  return res.body.totals;
}

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'transferci');
  other = await createUserAndLogin(server, 'yabanci');

  bankId = await createAccount(user, 'Vadesiz TL', 'bank');
  cardId = await createAccount(user, 'Kredi Karti', 'credit_card');
  ikinciBankId = await createAccount(user, 'Ikinci Banka', 'bank');
});

after(async () => {
  await server.close();
});

describe('hesap arasi hareketler siradan gelir/gider sayilir', () => {
  test('transfer formu IKI SIRADAN islem yazar', async () => {
    const res = await user.post<{ transactions: { id: number; transferGroupId: string | null }[] }>(
      '/api/transactions/transfer',
      {
        fromAccountId: bankId,
        toAccountId: ikinciBankId,
        amountKurus: 500_000,
        date: '2027-01-15',
        description: 'Kendime aktarim',
      },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.transactions.length, 2);
    assert.ok(
      res.body.transactions.every((t) => t.transferGroupId === null),
      'satirlar birbirine BAGLANMAMALI',
    );
  });

  test('bu satirlar gelir ve gider toplamlarina GIRER', async () => {
    const totals = await monthlyTotals(user, '2027-01');
    assert.equal(totals.expenseKurus, 500_000, 'cikan bacak gider sayilmali');
    assert.equal(totals.incomeKurus, 500_000, 'giren bacak gelir sayilmali');
  });

  test('hesap bakiyeleri dogru: cikan eksi, giren arti', async () => {
    const accounts = await user.get<{ accounts: { id: number; balanceKurus: number }[] }>(
      '/api/accounts',
    );
    assert.equal(accounts.body.accounts.find((a) => a.id === bankId)?.balanceKurus, -500_000);
    assert.equal(accounts.body.accounts.find((a) => a.id === ikinciBankId)?.balanceKurus, 500_000);
  });

  test('olusan satirlar tek tek duzenlenebilir', async () => {
    // Eskiden transfer kayitlari duzenlenemiyordu; artik siradan islemler.
    const list = await user.get<{ transactions: { id: number; date: string }[] }>(
      '/api/transactions?from=2027-01-15&to=2027-01-15',
    );
    const first = list.body.transactions[0];
    assert.ok(first);

    const res = await user.patch(`/api/transactions/${first.id}`, {
      accountId: bankId,
      categoryId: null,
      type: 'expense',
      amountKurus: 500_000,
      date: '2027-01-15',
      description: 'Duzenlendi',
    });
    assert.equal(res.status, 200);
  });

  test('ice aktarim sonrasi hicbir satir kendiliginden tur degistirmez', async () => {
    // Ayni gun, ayni tutar, "kendime" aciklamali bir cift: eskiden otomatik
    // transfer sayilirdi.
    const a = await addTransaction(user, bankId, 'expense', 7_700, '2027-02-10', 'KENDIME gonderim');
    const b = await addTransaction(user, cardId, 'income', 7_700, '2027-02-10', 'KENDIME gelen');

    const list = await user.get<{ transactions: { id: number; type: string }[] }>(
      '/api/transactions?from=2027-02-10&to=2027-02-10',
    );
    const types = new Map(list.body.transactions.map((t) => [t.id, t.type]));

    assert.equal(types.get(a), 'expense');
    assert.equal(types.get(b), 'income');

    const totals = await monthlyTotals(user, '2027-02');
    assert.equal(totals.expenseKurus, 7_700, 'gider toplamina girmeli');
    assert.equal(totals.incomeKurus, 7_700, 'gelir toplamina girmeli');
  });
});

describe('toplu islem silme', () => {
  test('secilen islemler topluca silinir', async () => {
    const hesap = await createAccount(user, 'Toplu Silme Hesabi', 'cash');
    const ids = [
      await addTransaction(user, hesap, 'expense', 1_000, '2027-06-01', 'BIR'),
      await addTransaction(user, hesap, 'expense', 2_000, '2027-06-02', 'IKI'),
      await addTransaction(user, hesap, 'expense', 3_000, '2027-06-03', 'UC'),
    ];

    const res = await user.post<{ removedRows: number }>('/api/transactions/bulk-delete', {
      ids: [ids[0], ids[1]],
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.removedRows, 2);

    const kalan = await user.get<{ transactions: { id: number }[] }>(
      '/api/transactions?from=2027-06-01&to=2027-06-30',
    );
    assert.equal(kalan.body.transactions.length, 1);
    assert.equal(kalan.body.transactions[0]?.id, ids[2], 'secilmeyen kayit durmali');
  });

  test('yalnizca secilen satir silinir, esi durur', async () => {
    const a = await createAccount(user, 'Toplu A', 'bank');
    const b = await createAccount(user, 'Toplu B', 'bank');
    const gider = await addTransaction(user, a, 'expense', 9_900, '2027-07-01', 'KENDIME');
    await addTransaction(user, b, 'income', 9_900, '2027-07-01', 'KENDIME');

    const res = await user.post<{ removedRows: number }>('/api/transactions/bulk-delete', {
      ids: [gider],
    });
    assert.equal(res.body.removedRows, 1, 'yalnizca secilen silinmeli');

    const kalan = await user.get<{ transactions: unknown[] }>(
      '/api/transactions?from=2027-07-01&to=2027-07-31',
    );
    assert.equal(kalan.body.transactions.length, 1, 'esi yerinde durmali');
  });

  test('baskasinin islemi toplu silmeyle silinemez', async () => {
    const benim = await createAccount(user, 'Korunacak Hesap', 'cash');
    const id = await addTransaction(user, benim, 'expense', 4_242, '2027-08-01', 'KORUNSUN');

    const res = await other.post<{ removedRows: number }>('/api/transactions/bulk-delete', {
      ids: [id],
    });
    assert.equal(res.body.removedRows, 0, 'baskasinin kaydina dokunulmamali');

    const kalan = await user.get<{ transactions: unknown[] }>(
      '/api/transactions?from=2027-08-01&to=2027-08-31',
    );
    assert.equal(kalan.body.transactions.length, 1, 'kayit yerinde durmali');
  });
});
