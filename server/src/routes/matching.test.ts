import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

/**
 * Tekrar eden odeme onerileri ve toplu silme.
 */

let server: TestServer;
let user: TestClient;
let other: TestClient;

async function addTransaction(
  client: TestClient,
  type: 'income' | 'expense',
  amountKurus: number,
  date: string,
  description: string,
): Promise<number> {
  const res = await client.post<{ transaction: { id: number } }>('/api/transactions', {
    categoryId: null,
    type,
    amountKurus,
    date,
    description,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.transaction.id;
}

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'tekrarci');
  other = await createUserAndLogin(server, 'yabanci');
});

after(async () => {
  await server.close();
});

type Suggestion = { signature: string; kind: string; amountKurus: number; occurrences: number };

describe('tekrar eden odeme onerileri', () => {
  test('her ay ayni tutarla tekrar eden gider onerilir', async () => {
    for (const date of ['2027-01-05', '2027-02-05', '2027-03-05']) {
      await addTransaction(user, 'expense', 19_990, date, 'NETFLIX Abone 12345678');
    }

    const res = await user.get<{ suggestions: Suggestion[] }>('/api/matching/recurrences');
    assert.equal(res.status, 200);
    const netflix = res.body.suggestions.find((s) => s.signature === 'netflix abone');
    assert.ok(netflix, JSON.stringify(res.body));
    assert.equal(netflix.kind, 'subscription');
    assert.equal(netflix.amountKurus, 19_990);
    assert.equal(netflix.occurrences, 3);
  });

  test('reddedilen oneri bir daha gelmez', async () => {
    const reject = await user.post('/api/matching/recurrences/reject', {
      signature: 'netflix abone',
    });
    assert.ok(reject.status < 300);

    const res = await user.get<{ suggestions: Suggestion[] }>('/api/matching/recurrences');
    assert.ok(!res.body.suggestions.some((s) => s.signature === 'netflix abone'));
  });

  test('baskasinin islemleri oneri uretmez', async () => {
    const res = await other.get<{ suggestions: Suggestion[] }>('/api/matching/recurrences');
    assert.equal(res.body.suggestions.length, 0);
  });
});

describe('toplu islem silme', () => {
  test('secilen islemler topluca silinir', async () => {
    const ids = [
      await addTransaction(user, 'expense', 1_000, '2027-06-01', 'BIR'),
      await addTransaction(user, 'expense', 2_000, '2027-06-02', 'IKI'),
      await addTransaction(user, 'expense', 3_000, '2027-06-03', 'UC'),
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

  test('baskasinin islemi toplu silmeyle silinemez', async () => {
    const id = await addTransaction(user, 'expense', 4_242, '2027-08-01', 'KORUNSUN');

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
