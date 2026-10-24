import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin, loginAdmin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let user: TestClient;
let other: TestClient;

type Goal = {
  id: number;
  name: string;
  targetKurus: number;
  monthlyPlanKurus: number | null;
  isEmergencyFund: boolean;
  closed: boolean;
  contributedThisMonthKurus: number;
  progress: { savedKurus: number; remainingKurus: number; percent: number; reached: boolean };
};

type Overview = {
  goals: Goal[];
  totals: { savedKurus: number; monthlyPlanKurus: number };
  emergencyFund: { averageFixedExpenseKurus: number; minKurus: number; comfortableKurus: number };
};

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'birikimci');
  other = await createUserAndLogin(server, 'yabanci');
});

after(async () => {
  await server.close();
});

describe('birikim hedefleri', () => {
  let goalId: number;

  test('hedef olusturulur', async () => {
    const res = await user.post<{ goal: Goal }>('/api/savings', {
      name: 'Tatil',
      targetKurus: 3_000_000,
      monthlyPlanKurus: 250_000,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    goalId = res.body.goal.id;
    assert.equal(res.body.goal.progress.savedKurus, 0);
    assert.equal(res.body.goal.progress.remainingKurus, 3_000_000);
  });

  test('katki ve cekis birikimi gunceller', async () => {
    await user.post(`/api/savings/${goalId}/contributions`, {
      date: todayIso(),
      amountKurus: 500_000,
    });
    const res = await user.post<{ goal: Goal; contributions: { id: number }[] }>(
      `/api/savings/${goalId}/contributions`,
      { date: todayIso(), amountKurus: -100_000, note: 'Acil ihtiyac' },
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.goal.progress.savedKurus, 400_000);
    assert.equal(res.body.goal.contributedThisMonthKurus, 400_000);
    assert.equal(res.body.contributions.length, 2);
  });

  test('sifir tutarli katki reddedilir', async () => {
    const res = await user.post(`/api/savings/${goalId}/contributions`, {
      date: todayIso(),
      amountKurus: 0,
    });
    assert.equal(res.status, 400);
  });

  test('katki silinince birikim geri doner', async () => {
    const detail = await user.get<{ contributions: { id: number; amountKurus: number }[] }>(
      `/api/savings/${goalId}`,
    );
    const withdrawal = detail.body.contributions.find((c) => c.amountKurus < 0);
    assert.ok(withdrawal);
    const res = await user.delete<{ goal: Goal }>(
      `/api/savings/${goalId}/contributions/${withdrawal.id}`,
    );
    assert.equal(res.body.goal.progress.savedKurus, 500_000);
  });

  test('birikim gider olarak islemlere YAZILMAZ', async () => {
    const res = await user.get<{ totals: { expenseKurus: number } }>('/api/transactions');
    assert.equal(res.body.totals.expenseKurus, 0);
  });

  test('ay durumunda birikim serbest paradan dusulur (plan ile katkinin buyugu)', async () => {
    const res = await user.get<{ savingsKurus: number; freeKurus: number }>('/api/budgets/overview');
    // Plan 250.000, bu ay katki 500.000 -> 500.000
    assert.equal(res.body.savingsKurus, 500_000);
    assert.equal(res.body.freeKurus, -500_000);
  });

  test('kapatilan hedef listeden cikar', async () => {
    const res = await user.patch<{ goal: Goal }>(`/api/savings/${goalId}`, {
      name: 'Tatil',
      targetKurus: 3_000_000,
      closed: true,
    });
    assert.equal(res.body.goal.closed, true);

    const list = await user.get<Overview>('/api/savings');
    assert.ok(!list.body.goals.some((g) => g.id === goalId));
    const all = await user.get<Overview>('/api/savings?includeClosed=true');
    assert.ok(all.body.goals.some((g) => g.id === goalId));
  });
});

describe('acil durum fonu onerisi', () => {
  test('gecmis aylarin sabit giderinden 3 ve 6 aylik oneri cikar', async () => {
    const acil = await createUserAndLogin(server, 'acilci');
    const categories = await acil.get<{ categories: { id: number; name: string }[] }>(
      '/api/categories',
    );
    const kira = categories.body.categories.find((c) => c.name === 'Kira')!;
    const market = categories.body.categories.find((c) => c.name === 'Market')!;

    // Gecen ay: 1.000.000 kira (sabit) + 500.000 market (degisken)
    const [y, m] = todayIso().split('-').map(Number) as [number, number];
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    await acil.post('/api/transactions', {
      type: 'expense',
      categoryId: kira.id,
      amountKurus: 1_000_000,
      date: `${prev}-01`,
    });
    await acil.post('/api/transactions', {
      type: 'expense',
      categoryId: market.id,
      amountKurus: 500_000,
      date: `${prev}-10`,
    });

    const res = await acil.get<Overview>('/api/savings');
    assert.equal(res.body.emergencyFund.averageFixedExpenseKurus, 1_000_000);
    assert.equal(res.body.emergencyFund.minKurus, 3_000_000);
    assert.equal(res.body.emergencyFund.comfortableKurus, 6_000_000);
  });
});

describe('veri izolasyonu', () => {
  test('baskasinin hedefi okunamaz ve katki eklenemez', async () => {
    const created = await user.post<{ goal: Goal }>('/api/savings', {
      name: 'Gizli hedef',
      targetKurus: 100_000,
    });
    const id = created.body.goal.id;

    assert.equal((await other.get(`/api/savings/${id}`)).status, 404);
    assert.equal(
      (await other.post(`/api/savings/${id}/contributions`, { date: todayIso(), amountKurus: 1 }))
        .status,
      404,
    );
    assert.equal((await other.delete(`/api/savings/${id}`)).status, 404);
  });

  test('super admin birikim uclarina erisemez', async () => {
    const admin = await loginAdmin(server);
    assert.equal((await admin.get('/api/savings')).status, 403);
  });
});
