import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let user: TestClient;
let other: TestClient;
let categoryId: number;

type Item = {
  id: number;
  kind: string;
  name: string;
  progress: { total: number; confirmed: number; pending: number };
  nextDueDate: string | null;
  remainingKurus: number;
};

type Occurrence = {
  id: number;
  dueDate: string;
  amountKurus: number | null;
  status: string;
  transactionId: number | null;
  seq: number | null;
  totalSeq: number | null;
};

async function occurrencesOf(client: TestClient, itemId: number): Promise<Occurrence[]> {
  const res = await client.get<{ occurrences: Occurrence[] }>(`/api/scheduled/${itemId}/occurrences`);
  assert.equal(res.status, 200);
  return res.body.occurrences;
}

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'ayse');
  other = await createUserAndLogin(server, 'mehmet');

  const categories = await user.get<{ categories: { id: number; name: string }[] }>('/api/categories');
  const fatura = categories.body.categories.find((c) => c.name === 'Fatura');
  assert.ok(fatura);
  categoryId = fatura.id;
});

after(async () => {
  await server.close();
});

describe('planlanan odeme/alacak', () => {
  let itemId: number;

  test('planlanan kayit tek vade uretir', async () => {
    const res = await user.post<{ item: Item }>('/api/scheduled', {
      kind: 'planned',
      name: 'Arkadasa borc',
      direction: 'income',
      amountKurus: 50_000,
      startDate: '2026-09-15',
      counterparty: 'Ali',
    });

    assert.equal(res.status, 201);
    itemId = res.body.item.id;
    assert.equal(res.body.item.progress.total, 1);
    assert.equal(res.body.item.nextDueDate, '2026-09-15');
  });

  test('ONAYLANMADAN raporlara girmez', async () => {
    const report = await user.get<{ totals: { incomeKurus: number } }>(
      '/api/reports/monthly?month=2026-09',
    );
    assert.equal(report.body.totals.incomeKurus, 0, 'bekleyen kayit gelire sayilmamali');
  });

  test('onaylaninca gercek islem olusur ve raporlara girer', async () => {
    const occurrences = await occurrencesOf(user, itemId);
    const first = occurrences[0];
    assert.ok(first);

    const res = await user.post<{ occurrence: Occurrence }>(`/api/occurrences/${first.id}/confirm`);
    assert.equal(res.status, 200);
    assert.equal(res.body.occurrence.status, 'confirmed');
    assert.ok(res.body.occurrence.transactionId);

    const report = await user.get<{ totals: { incomeKurus: number } }>(
      '/api/reports/monthly?month=2026-09',
    );
    assert.equal(report.body.totals.incomeKurus, 50_000);
  });

  test('ayni vade ikinci kez onaylanamaz', async () => {
    const occurrences = await occurrencesOf(user, itemId);
    const first = occurrences[0];
    assert.ok(first);

    const res = await user.post(`/api/occurrences/${first.id}/confirm`);
    assert.equal(res.status, 409);
  });

  test('onay geri alinabilir; olusan islem silinir', async () => {
    const occurrences = await occurrencesOf(user, itemId);
    const first = occurrences[0];
    assert.ok(first);

    const res = await user.post(`/api/occurrences/${first.id}/unconfirm`);
    assert.equal(res.status, 200);

    const report = await user.get<{ totals: { incomeKurus: number } }>(
      '/api/reports/monthly?month=2026-09',
    );
    assert.equal(report.body.totals.incomeKurus, 0, 'islem geri alinmali');
  });
});

describe('taksitli odeme', () => {
  let itemId: number;

  test('12 taksitte toplam tutar KORUNUR', async () => {
    const res = await user.post<{ item: Item }>('/api/scheduled', {
      kind: 'installment',
      name: 'Telefon',
      categoryId,
      totalAmountKurus: 100_007, // bolunmeyen tutar
      installmentCount: 12,
      startDate: '2026-09-05',
    });

    assert.equal(res.status, 201);
    itemId = res.body.item.id;

    const occurrences = await occurrencesOf(user, itemId);
    assert.equal(occurrences.length, 12);

    const sum = occurrences.reduce((acc, o) => acc + (o.amountKurus ?? 0), 0);
    assert.equal(sum, 100_007, 'taksitlerin toplami ana tutara esit olmali');

    // Artan kurus ilk taksitlere dagitilir
    assert.equal(occurrences[0]?.amountKurus, 8_334);
    assert.equal(occurrences[11]?.amountKurus, 8_333);
  });

  test('vadeler aylik ilerler ve yil sinirini gecer', async () => {
    const occurrences = await occurrencesOf(user, itemId);
    assert.equal(occurrences[0]?.dueDate, '2026-09-05');
    assert.equal(occurrences[3]?.dueDate, '2026-12-05');
    assert.equal(occurrences[4]?.dueDate, '2027-01-05');
  });

  test('ilerleme 3/12 olarak izlenir', async () => {
    const occurrences = await occurrencesOf(user, itemId);
    for (const occurrence of occurrences.slice(0, 3)) {
      await user.post(`/api/occurrences/${occurrence.id}/confirm`);
    }

    const res = await user.get<{ items: Item[] }>('/api/scheduled?kind=installment');
    const item = res.body.items.find((i) => i.id === itemId);
    assert.ok(item);
    assert.equal(item.progress.confirmed, 3);
    assert.equal(item.progress.total, 12);
    assert.equal(item.progress.pending, 9);
  });

  test('taksit sayisi 1 olamaz', async () => {
    const res = await user.post('/api/scheduled', {
      kind: 'installment',
      name: 'Tek taksit',
      totalAmountKurus: 10_000,
      installmentCount: 1,
      startDate: '2026-09-05',
    });
    assert.equal(res.status, 400);
  });

  test('taksit gelir olarak tanimlanamaz', async () => {
    const res = await user.post('/api/scheduled', {
      kind: 'installment',
      name: 'Gelir taksiti',
      direction: 'income',
      totalAmountKurus: 10_000,
      installmentCount: 3,
      startDate: '2026-09-05',
    });
    assert.equal(res.status, 400);
  });
});

describe('fatura', () => {
  let itemId: number;

  test('aylik fatura ufka kadar vade uretir, tutar BOS gelir', async () => {
    const res = await user.post<{ item: Item }>('/api/scheduled', {
      kind: 'bill',
      name: 'Elektrik',
      categoryId,
      period: 'monthly',
      startDate: '2026-08-20',
    });

    assert.equal(res.status, 201);
    itemId = res.body.item.id;

    const occurrences = await occurrencesOf(user, itemId);
    assert.ok(occurrences.length >= 12, `ufka kadar vade uretilmeli, ${occurrences.length}`);
    assert.equal(occurrences[0]?.amountKurus, null, 'tutari kullanici girer');
  });

  test('tutar girilmeden onaylanamaz', async () => {
    const occurrences = await occurrencesOf(user, itemId);
    const first = occurrences[0];
    assert.ok(first);

    const res = await user.post<{ error: { message: string } }>(
      `/api/occurrences/${first.id}/confirm`,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /tutar/i);
  });

  test('tutar girilip onaylanabilir', async () => {
    const occurrences = await occurrencesOf(user, itemId);
    const first = occurrences[0];
    assert.ok(first);

    const patched = await user.patch<{ occurrence: Occurrence }>(`/api/occurrences/${first.id}`, {
      amountKurus: 47_550,
      dueDate: first.dueDate,
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.occurrence.amountKurus, 47_550);

    const confirmed = await user.post<{ occurrence: Occurrence }>(
      `/api/occurrences/${first.id}/confirm`,
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.occurrence.status, 'confirmed');
  });

  test('onaylanmis vade duzenlenemez', async () => {
    const occurrences = await occurrencesOf(user, itemId);
    const confirmed = occurrences.find((o) => o.status === 'confirmed');
    assert.ok(confirmed);

    const res = await user.patch(`/api/occurrences/${confirmed.id}`, {
      amountKurus: 1_000,
      dueDate: confirmed.dueDate,
    });
    assert.equal(res.status, 400);
  });

  test('uc aylik fatura ucer ay atlar', async () => {
    const created = await user.post<{ item: Item }>('/api/scheduled', {
      kind: 'bill',
      name: 'Aidat',
      period: 'quarterly',
      startDate: '2026-08-01',
    });

    const occurrences = await occurrencesOf(user, created.body.item.id);
    assert.equal(occurrences[0]?.dueDate, '2026-08-01');
    assert.equal(occurrences[1]?.dueDate, '2026-11-01');
    assert.equal(occurrences[2]?.dueDate, '2027-02-01');
  });
});

describe('zamanlanmis gorev (idempotency)', () => {
  test('ayni gun iki kez calissa da tek bildirim olusur', async () => {
    const { runDailyScan } = await import('../services/scheduler.ts');

    const first = runDailyScan();
    const second = runDailyScan();

    assert.ok(first.notificationsCreated >= 0);
    assert.equal(second.notificationsCreated, 0, 'ikinci tarama yeni bildirim uretmemeli');
  });

  test('mevcut vadeler cogaltilmaz', async () => {
    const items = await user.get<{ items: Item[] }>('/api/scheduled?kind=bill');
    const elektrik = items.body.items.find((i) => i.name === 'Elektrik');
    assert.ok(elektrik);

    const before = (await occurrencesOf(user, elektrik.id)).length;

    const { runDailyScan } = await import('../services/scheduler.ts');
    runDailyScan();

    const after = (await occurrencesOf(user, elektrik.id)).length;
    assert.equal(after, before, 'tarama mukerrer vade uretmemeli');
  });
});

describe('yaklasan vadeler ve bildirimler', () => {
  test('yaklasan vadeler listelenir', async () => {
    const res = await user.get<{ occurrences: Occurrence[]; overdueCount: number }>(
      '/api/scheduled/upcoming?days=365',
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.occurrences.length > 0);
  });

  test('gun araligi ust siniri asilamaz', async () => {
    const res = await user.get('/api/scheduled/upcoming?days=400');
    assert.equal(res.status, 400);
  });

  test('bildirim listesi ve okundu isaretleme calisir', async () => {
    const list = await user.get<{ notifications: { id: number }[]; unreadCount: number }>(
      '/api/notifications',
    );
    assert.equal(list.status, 200);

    if (list.body.notifications.length > 0) {
      const first = list.body.notifications[0];
      assert.ok(first);
      const read = await user.post<{ unreadCount: number }>(`/api/notifications/${first.id}/read`);
      assert.equal(read.status, 200);

      const all = await user.post<{ unreadCount: number }>('/api/notifications/read-all');
      assert.equal(all.body.unreadCount, 0);
    }
  });

  test('baskasinin bildirimi okunamaz', async () => {
    const list = await user.get<{ notifications: { id: number }[] }>('/api/notifications');
    const first = list.body.notifications[0];
    if (first) {
      const res = await other.post(`/api/notifications/${first.id}/read`);
      assert.equal(res.status, 404);
    }
  });
});

describe('veri izolasyonu ve silme', () => {
  test('baskasinin zamanlanmis kaydina erisilemez', async () => {
    const items = await user.get<{ items: Item[] }>('/api/scheduled');
    const first = items.body.items[0];
    assert.ok(first);

    assert.equal((await other.get(`/api/scheduled/${first.id}/occurrences`)).status, 404);
    assert.equal((await other.delete(`/api/scheduled/${first.id}`)).status, 404);
  });

  test('kayit silinince ONAYLANMIS islemler korunur', async () => {
    const items = await user.get<{ items: Item[] }>('/api/scheduled?kind=installment');
    const telefon = items.body.items.find((i) => i.name === 'Telefon');
    assert.ok(telefon);

    const beforeReport = await user.get<{ totals: { expenseKurus: number } }>(
      '/api/reports/monthly?month=2026-09',
    );
    const beforeExpense = beforeReport.body.totals.expenseKurus;
    assert.ok(beforeExpense > 0);

    const res = await user.delete<{ keptTransactions: number }>(`/api/scheduled/${telefon.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.keptTransactions, 3);

    const afterReport = await user.get<{ totals: { expenseKurus: number } }>(
      '/api/reports/monthly?month=2026-09',
    );
    assert.equal(
      afterReport.body.totals.expenseKurus,
      beforeExpense,
      'gerceklesmis harcama plan silinince yok sayilmamali',
    );
  });
});
