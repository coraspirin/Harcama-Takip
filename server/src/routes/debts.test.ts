import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin, loginAdmin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let user: TestClient;
let other: TestClient;

type Forecast = {
  status: string;
  months: number | null;
  payoffMonth: string | null;
  totalInterestKurus: number | null;
};

type Debt = {
  id: number;
  kind: string;
  direction: string;
  name: string;
  originalKurus: number;
  reportedBalanceKurus: number;
  currentBalanceKurus: number;
  paidSinceKurus: number;
  monthlyPaymentKurus: number | null;
  closed: boolean;
  forecast: Forecast | null;
};

type DebtList = {
  debts: Debt[];
  installments: { itemId: number; name: string; remainingKurus: number; remainingCount: number }[];
  totals: {
    oweKurus: number;
    lentKurus: number;
    monthlyPaymentKurus: number;
    debtFreeMonth: string | null;
    unknownForecastCount: number;
  };
};

async function createDebt(client: TestClient, body: Record<string, unknown>): Promise<Debt> {
  const res = await client.post<{ debt: Debt }>('/api/debts', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.debt;
}

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'borclu');
  other = await createUserAndLogin(server, 'yabanci');
});

after(async () => {
  await server.close();
});

describe('borc olusturma ve tahmin', () => {
  test('faizli kredi olusturulur ve bitme tahmini doner', async () => {
    const debt = await createDebt(user, {
      kind: 'loan',
      name: 'Ihtiyac kredisi',
      balanceKurus: 1_000_000,
      monthlyInterestBp: 425,
      monthlyPaymentKurus: 100_000,
      balanceDate: '2026-01-01',
    });

    assert.equal(debt.currentBalanceKurus, 1_000_000);
    assert.equal(debt.originalKurus, 1_000_000, 'baslangic tutari bos birakilirsa bakiye olur');
    assert.equal(debt.forecast?.status, 'ends');
    assert.equal(debt.forecast?.months, 14);
    assert.ok((debt.forecast?.totalInterestKurus ?? 0) > 0);
  });

  test('odeme faizi karsilamiyorsa "bitmiyor" doner', async () => {
    const debt = await createDebt(user, {
      kind: 'credit_card',
      name: 'Kredi karti',
      balanceKurus: 5_000_000,
      monthlyInterestBp: 400,
      taxesIncluded: true,
      monthlyPaymentKurus: 100_000,
      balanceDate: '2026-01-01',
    });
    assert.equal(debt.forecast?.status, 'never');
  });

  test('alacak yalnizca kisilerle olan borclarda secilebilir', async () => {
    const res = await user.post('/api/debts', {
      kind: 'loan',
      direction: 'lent',
      name: 'Gecersiz',
      balanceKurus: 1000,
    });
    assert.equal(res.status, 400);

    const lent = await createDebt(user, {
      kind: 'personal',
      direction: 'lent',
      name: 'Ali\'ye verilen',
      counterparty: 'Ali',
      balanceKurus: 300_000,
      monthlyPaymentKurus: 100_000,
      balanceDate: '2026-01-01',
    });
    assert.equal(lent.direction, 'lent');
    assert.equal(lent.forecast?.months, 3);
  });
});

describe('odeme ve bakiye', () => {
  let debtId: number;

  before(async () => {
    const debt = await createDebt(user, {
      kind: 'personal',
      name: 'Anneme borc',
      counterparty: 'Annem',
      balanceKurus: 500_000,
      monthlyPaymentKurus: 100_000,
      balanceDate: '2026-03-01',
    });
    debtId = debt.id;
  });

  test('bildirilen bakiyeden SONRAKI odeme guncel bakiyeyi dusurur', async () => {
    const res = await user.post<{ debt: Debt; affectsBalance: boolean }>(
      `/api/debts/${debtId}/payments`,
      { date: '2026-03-15', amountKurus: 150_000 },
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.affectsBalance, true);
    assert.equal(res.body.debt.currentBalanceKurus, 350_000);
    assert.equal(res.body.debt.paidSinceKurus, 150_000);
  });

  test('bildirilen bakiyeden ONCEKI odeme bakiyeyi degistirmez ve bu bildirilir', async () => {
    const res = await user.post<{ debt: Debt; affectsBalance: boolean }>(
      `/api/debts/${debtId}/payments`,
      { date: '2026-02-20', amountKurus: 50_000 },
    );
    assert.equal(res.body.affectsBalance, false);
    assert.equal(res.body.debt.currentBalanceKurus, 350_000);
  });

  test('odeme gider olarak islemlere YAZILMAZ', async () => {
    const res = await user.get<{ totals: { expenseKurus: number } }>(
      '/api/transactions?from=2026-02-01&to=2026-03-31',
    );
    assert.equal(res.body.totals.expenseKurus, 0, 'borc odemesi gider degildir');
  });

  test('bakiye guncellenince eski odemeler bakiyeye tekrar sayilmaz', async () => {
    const res = await user.post<{ debt: Debt }>(`/api/debts/${debtId}/balance`, {
      balanceKurus: 340_000,
      date: '2026-03-20',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.debt.reportedBalanceKurus, 340_000);
    assert.equal(res.body.debt.currentBalanceKurus, 340_000);
    assert.equal(res.body.debt.paidSinceKurus, 0);
  });

  test('odeme silinince bakiye geri gelir', async () => {
    const added = await user.post<{ debt: Debt }>(`/api/debts/${debtId}/payments`, {
      date: '2026-04-01',
      amountKurus: 40_000,
    });
    assert.equal(added.body.debt.currentBalanceKurus, 300_000);

    const detail = await user.get<{ payments: { id: number; date: string }[] }>(
      `/api/debts/${debtId}`,
    );
    const payment = detail.body.payments.find((p) => p.date === '2026-04-01');
    assert.ok(payment);

    const removed = await user.delete<{ debt: Debt }>(
      `/api/debts/${debtId}/payments/${payment.id}`,
    );
    assert.equal(removed.body.debt.currentBalanceKurus, 340_000);
  });

  test('bakiye odemelerle sifirin altina inmez', async () => {
    const res = await user.post<{ debt: Debt }>(`/api/debts/${debtId}/payments`, {
      date: '2026-05-01',
      amountKurus: 999_999,
    });
    assert.equal(res.body.debt.currentBalanceKurus, 0);
    assert.equal(res.body.debt.forecast?.status, 'paid');
  });
});

describe('borc ozeti', () => {
  test('taksitler borc listesine ve toplamlara katilir', async () => {
    const ozet = await createUserAndLogin(server, 'ozetci');

    await ozet.post('/api/scheduled', {
      kind: 'installment',
      name: 'Buzdolabi',
      totalAmountKurus: 1_200_000,
      installmentCount: 12,
      startDate: '2030-01-10',
    });
    await createDebt(ozet, {
      kind: 'loan',
      name: 'Tasit kredisi',
      balanceKurus: 600_000,
      monthlyPaymentKurus: 100_000,
    });
    await createDebt(ozet, {
      kind: 'personal',
      direction: 'lent',
      name: 'Arkadasa verilen',
      balanceKurus: 50_000,
    });

    const res = await ozet.get<DebtList>('/api/debts');
    assert.equal(res.status, 200);
    assert.equal(res.body.installments.length, 1);
    assert.equal(res.body.installments[0]?.remainingCount, 12);
    assert.equal(res.body.installments[0]?.remainingKurus, 1_200_000);

    // Borc: kredi + taksit; alacak ayri
    assert.equal(res.body.totals.oweKurus, 1_800_000);
    assert.equal(res.body.totals.lentKurus, 50_000);
    assert.equal(res.body.totals.monthlyPaymentKurus, 200_000);
    // En gec biten: son taksit (2030-12)
    assert.equal(res.body.totals.debtFreeMonth, '2030-12');
    assert.equal(res.body.totals.unknownForecastCount, 0);
  });

  test('bitme tarihi hesaplanamayan borc varsa borcsuz kalma ayi verilmez', async () => {
    const res = await user.get<DebtList>('/api/debts');
    assert.equal(res.body.totals.debtFreeMonth, null);
    assert.ok(res.body.totals.unknownForecastCount >= 1, 'kredi karti bitmiyor');
  });

  test('kapatilan borc listeden ve toplamlardan cikar', async () => {
    const debt = await createDebt(other, {
      kind: 'personal',
      name: 'Kapanacak',
      balanceKurus: 10_000,
    });

    const closed = await other.patch<{ debt: Debt }>(`/api/debts/${debt.id}`, {
      kind: 'personal',
      name: 'Kapanacak',
      originalKurus: 10_000,
      closed: true,
    });
    assert.equal(closed.body.debt.closed, true);
    assert.equal(closed.body.debt.forecast, null);

    const list = await other.get<DebtList>('/api/debts');
    assert.ok(!list.body.debts.some((d) => d.id === debt.id));

    const withClosed = await other.get<DebtList>('/api/debts?includeClosed=true');
    assert.ok(withClosed.body.debts.some((d) => d.id === debt.id));
  });
});

describe('fazla odeme senaryolari', () => {
  test('detayda ayda fazladan odemenin etkisi hesaplanir', async () => {
    const debt = await createDebt(user, {
      kind: 'loan',
      name: 'Senaryo kredisi',
      balanceKurus: 1_000_000,
      monthlyInterestBp: 425,
      monthlyPaymentKurus: 100_000,
    });

    const res = await user.get<{
      schedule: unknown[];
      whatIf: { monthsSaved: number | null; interestSavedKurus: number | null };
    }>(`/api/debts/${debt.id}?extra=50000`);

    assert.equal(res.status, 200);
    assert.equal(res.body.schedule.length, 14);
    assert.ok((res.body.whatIf.monthsSaved ?? 0) > 0);
    assert.ok((res.body.whatIf.interestSavedKurus ?? 0) > 0);
  });

  test('plan: cig ve kartopu yontemleri karsilastirilir', async () => {
    const planci = await createUserAndLogin(server, 'planci');
    await createDebt(planci, {
      kind: 'personal',
      name: 'Kucuk borc',
      balanceKurus: 200_000,
      monthlyPaymentKurus: 20_000,
    });
    await createDebt(planci, {
      kind: 'credit_card',
      name: 'Kart',
      balanceKurus: 1_500_000,
      monthlyInterestBp: 400,
      taxesIncluded: true,
      monthlyPaymentKurus: 100_000,
    });

    const res = await planci.get<{
      avalanche: { status: string; months: number; totalInterestKurus: number };
      snowball: { status: string; order: { name: string }[]; totalInterestKurus: number };
      baseline: { months: number };
    }>('/api/debts/plan?extra=100000');

    assert.equal(res.status, 200);
    assert.equal(res.body.avalanche.status, 'ends');
    assert.equal(res.body.snowball.order[0]?.name, 'Kucuk borc');
    assert.ok(res.body.avalanche.totalInterestKurus <= res.body.snowball.totalInterestKurus);
    assert.ok(res.body.avalanche.months < res.body.baseline.months);
  });
});

describe('veri izolasyonu', () => {
  test('baskasinin borcu okunamaz, degistirilemez, odeme eklenemez', async () => {
    const mine = await createDebt(user, { kind: 'personal', name: 'Gizli borc', balanceKurus: 1000 });

    assert.equal((await other.get(`/api/debts/${mine.id}`)).status, 404);
    assert.equal(
      (await other.post(`/api/debts/${mine.id}/payments`, { date: '2026-01-01', amountKurus: 1 }))
        .status,
      404,
    );
    assert.equal(
      (await other.post(`/api/debts/${mine.id}/balance`, { balanceKurus: 0 })).status,
      404,
    );
    assert.equal((await other.delete(`/api/debts/${mine.id}`)).status, 404);

    const list = await other.get<DebtList>('/api/debts');
    assert.ok(!list.body.debts.some((d) => d.id === mine.id));
  });

  test('super admin borc uclarina erisemez', async () => {
    const admin = await loginAdmin(server);
    assert.equal((await admin.get('/api/debts')).status, 403);
  });

  test('veri sifirlama borclari da siler', async () => {
    const silinecek = await createUserAndLogin(server, 'sifirlayan');
    await createDebt(silinecek, { kind: 'personal', name: 'Gidecek', balanceKurus: 1000 });

    const reset = await silinecek.post('/api/data/reset', { confirm: 'VERIMI SIL' });
    assert.equal(reset.status, 200);

    const list = await silinecek.get<DebtList>('/api/debts');
    assert.equal(list.body.debts.length, 0);
  });
});
