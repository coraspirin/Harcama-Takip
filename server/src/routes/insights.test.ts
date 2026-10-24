import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin, loginAdmin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let user: TestClient;

/** Bugunden n ay onceki "YYYY-MM" (Europe/Istanbul). */
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

type Notification = { type: string; title: string; body: string | null };

async function notifications(client: TestClient): Promise<Notification[]> {
  const res = await client.get<{ notifications: Notification[] }>('/api/notifications');
  return res.body.notifications;
}

async function scan() {
  const { runDailyScan } = await import('../services/scheduler.ts');
  return runDailyScan();
}

let marketId: number;

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'uyarici');
  const categories = await user.get<{ categories: { id: number; name: string }[] }>(
    '/api/categories',
  );
  marketId = categories.body.categories.find((c) => c.name === 'Market')!.id;
});

after(async () => {
  await server.close();
});

describe('gunluk uyarilar', () => {
  test('limit %80 uyarisi ve asim uyarisi ayda birer kez uretilir', async () => {
    const month = monthsAgo(0);
    await user.post('/api/budgets', { categoryId: marketId, yearMonth: month, limitKurus: 100_000 });
    await user.post('/api/transactions', {
      type: 'expense', categoryId: marketId, amountKurus: 85_000, date: `${month}-01`,
    });

    await scan();
    await scan();
    let list = await notifications(user);
    assert.equal(list.filter((n) => n.type === 'budget.warning').length, 1, 'tek uyari');

    await user.post('/api/transactions', {
      type: 'expense', categoryId: marketId, amountKurus: 30_000, date: `${month}-01`,
    });
    await scan();
    await scan();
    list = await notifications(user);
    assert.equal(list.filter((n) => n.type === 'budget.exceeded').length, 1);
  });

  test('kategori harcamasi ortalamanin cok ustune cikinca uyari', async () => {
    const anormal = await createUserAndLogin(server, 'anormal');
    const categories = await anormal.get<{ categories: { id: number; name: string }[] }>(
      '/api/categories',
    );
    const eglence = categories.body.categories.find((c) => c.name === 'Eglence')!.id;

    for (const n of [1, 2, 3]) {
      await anormal.post('/api/transactions', {
        type: 'expense', categoryId: eglence, amountKurus: 100_000, date: `${monthsAgo(n)}-05`,
      });
    }
    await anormal.post('/api/transactions', {
      type: 'expense', categoryId: eglence, amountKurus: 300_000, date: `${monthsAgo(0)}-01`,
    });

    await scan();
    await scan();
    const list = await notifications(anormal);
    const anomalies = list.filter((n) => n.type === 'spending.anomaly');
    assert.equal(anomalies.length, 1);
    assert.match(anomalies[0]!.title, /Eglence/);
  });

  test('onceki ayin kapanis ozeti bir kez uretilir', async () => {
    const kapanis = await createUserAndLogin(server, 'kapanis');
    const prev = monthsAgo(1);
    await kapanis.post('/api/transactions', { type: 'income', amountKurus: 500_000, date: `${prev}-01` });
    await kapanis.post('/api/transactions', { type: 'expense', amountKurus: 200_000, date: `${prev}-02` });

    await scan();
    await scan();
    const closings = (await notifications(kapanis)).filter((n) => n.type === 'month.closing');
    assert.equal(closings.length, 1);
    assert.match(closings[0]!.body ?? '', /net/);
  });

  test('verisi olmayan kullaniciya kapanis uretilmez', async () => {
    const bos = await createUserAndLogin(server, 'bosuser');
    await scan();
    assert.equal((await notifications(bos)).filter((n) => n.type === 'month.closing').length, 0);
  });
});

describe('ay kapanislari raporu', () => {
  test('son aylarin ozetleri doner', async () => {
    const raporcu = await createUserAndLogin(server, 'kapanisraporu');
    const prev = monthsAgo(1);
    await raporcu.post('/api/transactions', { type: 'income', amountKurus: 1_000_000, date: `${prev}-01` });
    await raporcu.post('/api/transactions', {
      type: 'expense', categoryId: null, amountKurus: 400_000, date: `${prev}-03`,
    });
    await raporcu.post('/api/budgets', { yearMonth: prev, limitKurus: 300_000 });

    const res = await raporcu.get<{
      closings: {
        month: string;
        hasData: boolean;
        netKurus: number;
        limit: { kept: boolean } | null;
      }[];
    }>('/api/reports/closings?count=3');

    assert.equal(res.status, 200);
    assert.equal(res.body.closings.length, 3);
    const last = res.body.closings[0]!;
    assert.equal(last.month, prev);
    assert.equal(last.hasData, true);
    assert.equal(last.netKurus, 600_000);
    assert.equal(last.limit?.kept, false);
    assert.equal(res.body.closings[1]!.hasData, false);
  });
});

describe('takvim', () => {
  test('gunler, bekleyen odemeler ve net akis doner', async () => {
    const takvimci = await createUserAndLogin(server, 'takvimci');
    const next = monthsAgo(-1);
    await takvimci.post('/api/scheduled', {
      kind: 'planned',
      name: 'Kira',
      direction: 'expense',
      amountKurus: 900_000,
      startDate: `${next}-05`,
    });
    await takvimci.post('/api/scheduled', {
      kind: 'planned',
      name: 'Maas',
      direction: 'income',
      amountKurus: 2_000_000,
      startDate: `${next}-15`,
    });

    const res = await takvimci.get<{
      days: { date: string; pending: { name: string }[]; cumulativeKurus: number; tight: boolean }[];
      tightDayCount: number;
      endCumulativeKurus: number;
    }>(`/api/calendar?month=${next}`);

    assert.equal(res.status, 200);
    const fifth = res.body.days[4]!;
    assert.equal(fifth.pending[0]?.name, 'Kira');
    assert.equal(fifth.cumulativeKurus, -900_000);
    assert.equal(fifth.tight, true);
    assert.equal(res.body.tightDayCount, 10, '5-14 arasi sikisik');
    assert.equal(res.body.endCumulativeKurus, 1_100_000);
  });

  test('super admin takvime erisemez', async () => {
    const admin = await loginAdmin(server);
    assert.equal((await admin.get('/api/calendar')).status, 403);
  });
});
