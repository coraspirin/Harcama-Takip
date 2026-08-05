import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let user: TestClient;
let other: TestClient;
let bankId: number;
let cardId: number;
let cashId: number;

type Summary = {
  balanceKurus: number;
  statement: { id: number; statementAmountKurus: number } | null;
  interest: { estimatedDebtKurus: number; totalInterestKurus: number; unpaidKurus: number } | null;
  reconciliation: { differenceKurus: number; matches: boolean } | null;
  warning: string | null;
};

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'ayse');
  other = await createUserAndLogin(server, 'mehmet');

  const bank = await user.post<{ bank: { id: number } }>('/api/banks', {
    name: 'Kart Bankasi',
    monthlyInterestBp: 311,
    taxesIncluded: true,
  });
  bankId = bank.body.bank.id;

  const card = await user.post<{ account: { id: number } }>('/api/accounts', {
    name: 'Kredi Karti',
    type: 'credit_card',
    bankId,
    statementDay: 15,
    dueDay: 25,
    creditLimitKurus: 1_000_000,
  });
  assert.equal(card.status, 201);
  cardId = card.body.account.id;

  const cash = await user.post<{ account: { id: number } }>('/api/accounts', {
    name: 'Nakit',
    type: 'cash',
  });
  cashId = cash.body.account.id;
});

after(async () => {
  await server.close();
});

describe('ekstre kayitlari', () => {
  test('ekstre yalnizca kredi karti hesabina eklenebilir', async () => {
    const res = await user.post<{ error: { message: string } }>('/api/statements', {
      accountId: cashId,
      periodEnd: '2026-08-15',
      statementAmountKurus: 100_000,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /kredi karti/i);
  });

  test('son odeme tarihi kesim tarihinden once olamaz', async () => {
    const res = await user.post('/api/statements', {
      accountId: cardId,
      periodEnd: '2026-08-15',
      dueDate: '2026-08-10',
      statementAmountKurus: 100_000,
    });
    assert.equal(res.status, 400);
  });

  test('ekstre olusturulur ve listelenir', async () => {
    const res = await user.post<{ statement: { id: number } }>('/api/statements', {
      accountId: cardId,
      periodEnd: '2026-08-15',
      dueDate: '2026-08-25',
      statementAmountKurus: 100_000,
      paidAmountKurus: 40_000,
    });
    assert.equal(res.status, 201);

    const list = await user.get<{ statements: unknown[] }>(`/api/statements?accountId=${cardId}`);
    assert.equal(list.body.statements.length, 1);
  });

  test('ayni kesim tarihi icin ikinci ekstre reddedilir', async () => {
    const res = await user.post<{ error: { code: string } }>('/api/statements', {
      accountId: cardId,
      periodEnd: '2026-08-15',
      statementAmountKurus: 55_000,
    });
    assert.equal(res.status, 409);
  });
});

describe('tahmini faiz ozeti', () => {
  test('kismi odemede tahmini borc faizle birlikte doner', async () => {
    const res = await user.get<Summary>(`/api/statements/summary?accountId=${cardId}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.interest);

    // 1.000,00 ekstre - 400,00 odendi -> 600,00 kalan
    // %3,11 faiz = 18,66 + %30 vergi (5,60) = 24,26 -> tahmini borc 624,26
    assert.equal(res.body.interest.unpaidKurus, 60_000);
    assert.equal(res.body.interest.totalInterestKurus, 2_426);
    assert.equal(res.body.interest.estimatedDebtKurus, 62_426);
    assert.equal(res.body.warning, null);
  });

  test('ekstre ile islemler arasindaki fark bildirilir', async () => {
    // Karta 750,00 TL harcama girelim; ekstre 1.000,00 -> 250,00 fark
    await user.post('/api/transactions', {
      accountId: cardId,
      type: 'expense',
      amountKurus: 75_000,
      date: '2026-08-10',
      description: 'Alisveris',
    });

    const res = await user.get<Summary>(`/api/statements/summary?accountId=${cardId}`);
    assert.ok(res.body.reconciliation);
    assert.equal(res.body.reconciliation.matches, false);
    assert.equal(res.body.reconciliation.differenceKurus, 25_000);
  });

  test('BAKIYE ekstreden degil islemlerden gelir', async () => {
    const res = await user.get<Summary>(`/api/statements/summary?accountId=${cardId}`);
    // Tek islem 750,00 gider -> bakiye -750,00 (borc). Ekstredeki 1.000,00
    // bakiyeyi ETKILEMEZ.
    assert.equal(res.body.balanceKurus, -75_000);
  });

  test('bankasi olmayan kartta faiz hesaplanmaz ve uyari doner', async () => {
    const created = await user.post<{ account: { id: number } }>('/api/accounts', {
      name: 'Bankasiz Kart',
      type: 'credit_card',
      bankId: null,
    });
    const id = created.body.account.id;

    await user.post('/api/statements', {
      accountId: id,
      periodEnd: '2026-08-20',
      statementAmountKurus: 200_000,
      paidAmountKurus: 0,
    });

    const res = await user.get<Summary>(`/api/statements/summary?accountId=${id}`);
    assert.ok(res.body.interest);
    assert.equal(res.body.interest.totalInterestKurus, 0);
    assert.equal(res.body.interest.estimatedDebtKurus, 200_000);
    assert.match(res.body.warning ?? '', /banka/i);
  });

  test('ekstresi olmayan kartta ozet bos doner', async () => {
    const created = await user.post<{ account: { id: number } }>('/api/accounts', {
      name: 'Yeni Kart',
      type: 'credit_card',
      bankId,
    });

    const res = await user.get<Summary>(
      `/api/statements/summary?accountId=${created.body.account.id}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.statement, null);
    assert.equal(res.body.interest, null);
  });
});

describe('veri izolasyonu', () => {
  test('baskasinin kartinin ekstresi okunamaz', async () => {
    assert.equal((await other.get(`/api/statements?accountId=${cardId}`)).status, 404);
    assert.equal((await other.get(`/api/statements/summary?accountId=${cardId}`)).status, 404);

    const created = await other.post('/api/statements', {
      accountId: cardId,
      periodEnd: '2026-09-15',
      statementAmountKurus: 1_000,
    });
    assert.equal(created.status, 404);
  });
});
