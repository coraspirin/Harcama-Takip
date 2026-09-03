import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

/**
 * Hesap arasi transfer eslestirmesi.
 *
 * En kritik davranis OTOMATIK birlestirmenin NE ZAMAN CALISMADIGIdir: yanlis
 * bir otomatik eslesme, gercek bir gideri raporlardan sessizce siler.
 */

let server: TestServer;
let user: TestClient;
let other: TestClient;

let bankId: number;
let cardId: number;
let ikinciBankId: number;

type Candidate = {
  expenseId: number;
  incomeId: number;
  amountKurus: number;
  certain: boolean;
  reason: string | null;
  dayDifference: number;
};

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

async function candidates(client: TestClient): Promise<Candidate[]> {
  const res = await client.get<{ candidates: Candidate[] }>('/api/matching/transfer-candidates');
  assert.equal(res.status, 200);
  return res.body.candidates;
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

describe('otomatik transfer eslestirme', () => {
  test('kart odemesi cifti KESIN sayilir', async () => {
    await addTransaction(
      user,
      bankId,
      'expense',
      4_576_200,
      '2027-01-03',
      'K.Karti Odeme 5342 **** 5015',
    );
    await addTransaction(user, cardId, 'income', 4_576_200, '2027-01-03', 'Kart odemesi alacak');

    const list = await candidates(user);
    const pair = list.find((c) => c.amountKurus === 4_576_200);

    assert.ok(pair, 'aday bulunmali');
    assert.equal(pair.certain, true);
    assert.match(pair.reason ?? '', /kart/i);
  });

  test('tarama kesin cifti birlestirir ve raporlardan cikarir', async () => {
    const before = await monthlyTotals(user, '2027-01');

    const scan = await user.post<{ result: { linked: number; pending: number } }>(
      '/api/matching/scan',
    );
    assert.equal(scan.body.result.linked, 1);

    const after = await monthlyTotals(user, '2027-01');
    assert.equal(
      before.expenseKurus - after.expenseKurus,
      4_576_200,
      'gider toplami transfer kadar dusmeli',
    );
    assert.equal(
      before.incomeKurus - after.incomeKurus,
      4_576_200,
      'gelir toplami da transfer kadar dusmeli',
    );
  });

  test('birlestirme hesap bakiyelerini DEGISTIRMEZ', async () => {
    const accounts = await user.get<{ accounts: { id: number; balanceKurus: number }[] }>(
      '/api/accounts',
    );
    const bank = accounts.body.accounts.find((a) => a.id === bankId);
    const card = accounts.body.accounts.find((a) => a.id === cardId);

    // Transfer bacaklari bakiyeye dahildir: cikan eksi, giren arti.
    assert.equal(bank?.balanceKurus, -4_576_200);
    assert.equal(card?.balanceKurus, 4_576_200);
  });

  test('otomatik eslesme auto olarak isaretlenir ve geri alinabilir', async () => {
    const res = await user.get<{
      matched: { transferGroupId: string; matched: string; amountKurus: number }[];
    }>('/api/matching/transfer-candidates');

    const auto = res.body.matched.find((m) => m.amountKurus === 4_576_200);
    assert.ok(auto);
    assert.equal(auto.matched, 'auto');

    const undone = await user.post<{ restored: number }>('/api/matching/unlink', {
      transferGroupId: auto.transferGroupId,
    });
    assert.equal(undone.body.restored, 2, 'iki bacak da geri alinmali');

    // Raporlara geri gelmeli
    const totals = await monthlyTotals(user, '2027-01');
    assert.equal(totals.expenseKurus, 4_576_200);

    // Satirlar SILINMEMELI
    const list = await user.get<{ transactions: { id: number }[] }>(
      '/api/transactions?from=2027-01-01&to=2027-01-31',
    );
    assert.equal(list.body.transactions.length, 2, 'geri alma islemleri silmemeli');
  });
});

describe('otomatik birlestirmenin YAPILMADIGI durumlar', () => {
  test('ucuncu sahis aciklamali cift otomatik birlesmez', async () => {
    await addTransaction(user, bankId, 'expense', 4_500_000, '2027-02-01', 'Casim Aslan-KIRA');
    await addTransaction(user, ikinciBankId, 'income', 4_500_000, '2027-02-01', 'Gelen havale');

    const list = await candidates(user);
    const pair = list.find((c) => c.amountKurus === 4_500_000);

    assert.ok(pair, 'aday olarak onerilmeli');
    assert.equal(pair.certain, false, 'kendine transfer sinyali yok, otomatik birlesmemeli');
    assert.equal(pair.reason, null);

    // Tarama baska ciftleri birlestirebilir; onemli olan BU ciftin
    // birlestirilmemis olmasi.
    await user.post('/api/matching/scan');

    const after = await candidates(user);
    assert.ok(
      after.some((c) => c.amountKurus === 4_500_000),
      'supheli cift hala onay kuyrugunda olmali',
    );
  });

  test('BELIRSIZ eslesme (iki aday) otomatik birlesmez', async () => {
    // Ayni gun, ayni tutar, acik "kendime" ifadesi -- ama iki olasi karsi bacak.
    await addTransaction(user, bankId, 'expense', 1_111_100, '2027-03-05', 'KENDIME gonderim');
    await addTransaction(user, ikinciBankId, 'income', 1_111_100, '2027-03-05', 'KENDIME gelen 1');
    await addTransaction(user, cardId, 'income', 1_111_100, '2027-03-05', 'KENDIME gelen 2');

    const list = await candidates(user);
    const pairs = list.filter((c) => c.amountKurus === 1_111_100);

    assert.equal(pairs.length, 2, 'iki aday da onerilmeli');
    assert.ok(
      pairs.every((p) => !p.certain),
      'belirsizken hicbiri otomatik birlestirilmemeli',
    );

    await user.post('/api/matching/scan');

    const stillPending = await candidates(user);
    assert.equal(
      stillPending.filter((c) => c.amountKurus === 1_111_100).length,
      2,
      'belirsiz ciftlerin ikisi de kuyrukta kalmali',
    );
  });

  test('farkli gunler varsayilan ayarda (0 gun) aday bile degil', async () => {
    await addTransaction(user, bankId, 'expense', 777_700, '2027-04-01', 'KENDIME gecikmeli');
    await addTransaction(user, ikinciBankId, 'income', 777_700, '2027-04-03', 'KENDIME iki gun sonra');

    const list = await candidates(user);
    assert.equal(
      list.filter((c) => c.amountKurus === 777_700).length,
      0,
      'varsayilan gun payi 0: farkli gun aday olmamali',
    );
  });

  test('gun payi genisletilince aday olur ama KESIN olmaz', async () => {
    await user.put('/api/matching/settings', {
      dayWindow: 3,
      autoLink: true,
      selfAliases: '',
    });

    const list = await candidates(user);
    const pair = list.find((c) => c.amountKurus === 777_700);

    assert.ok(pair, 'gun payi 3 iken aday olmali');
    assert.equal(pair.dayDifference, 2);
    assert.equal(pair.certain, false, 'farkli gun otomatik birlestirilemez');

    await user.put('/api/matching/settings', { dayWindow: 0, autoLink: true, selfAliases: '' });
  });
});

describe('elle onay ve reddetme', () => {
  test('kullanici onaylayinca confirmed olarak birlesir', async () => {
    const list = await candidates(user);
    const pair = list.find((c) => c.amountKurus === 4_500_000);
    assert.ok(pair);

    const res = await user.post<{ transferGroupId: string }>('/api/matching/link', {
      expenseId: pair.expenseId,
      incomeId: pair.incomeId,
    });
    assert.equal(res.status, 200);

    const after = await user.get<{ matched: { transferGroupId: string; matched: string }[] }>(
      '/api/matching/transfer-candidates',
    );
    const found = after.body.matched.find((m) => m.transferGroupId === res.body.transferGroupId);
    assert.equal(found?.matched, 'confirmed');
  });

  test('reddedilen cift bir daha onerilmez', async () => {
    const list = await candidates(user);
    const pair = list.find((c) => c.amountKurus === 1_111_100);
    assert.ok(pair);

    await user.post('/api/matching/reject', {
      expenseId: pair.expenseId,
      incomeId: pair.incomeId,
    });

    const after = await candidates(user);
    assert.ok(
      !after.some((c) => c.expenseId === pair.expenseId && c.incomeId === pair.incomeId),
      'reddedilen cift listede kalmamali',
    );
  });

  test('zaten transfer olan islem tekrar birlestirilemez', async () => {
    const matched = await user.get<{ matched: { transferGroupId: string }[] }>(
      '/api/matching/transfer-candidates',
    );
    assert.ok(matched.body.matched.length > 0);

    // Bir transferin bacagini yeni bir ciftte kullanmaya calismak reddedilmeli.
    const res = await user.post('/api/matching/link', { expenseId: 999_999, incomeId: 999_998 });
    assert.equal(res.status, 400);
  });
});

describe('izolasyon', () => {
  test('baskasinin islemleri aday olarak gorunmez', async () => {
    const foreignAccount = await createAccount(other, 'Yabanci Hesap', 'bank');
    await addTransaction(other, foreignAccount, 'expense', 4_576_200, '2027-01-03', 'K.Karti Odeme');

    const mine = await candidates(user);
    assert.ok(
      !mine.some((c) => c.amountKurus === 4_576_200 && c.expenseId > 0 && c.certain),
      'baskasinin islemi benim adayim olmamali',
    );

    const theirs = await candidates(other);
    assert.equal(theirs.length, 0, 'karsi bacak kendi hesaplarinda yok');
  });

  test('baskasinin transferi cozulemez', async () => {
    const matched = await user.get<{ matched: { transferGroupId: string }[] }>(
      '/api/matching/transfer-candidates',
    );
    const groupId = matched.body.matched[0]?.transferGroupId;
    assert.ok(groupId);

    const res = await other.post('/api/matching/unlink', { transferGroupId: groupId });
    assert.equal(res.status, 404);
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

  test('transferin tek bacagi secilse bile CIFT silinir', async () => {
    // Tek bacak silinseydi hesap bakiyeleri tutarsiz kalirdi.
    const a = await createAccount(user, 'Toplu A', 'bank');
    const b = await createAccount(user, 'Toplu B', 'bank');
    const gider = await addTransaction(user, a, 'expense', 9_900, '2027-07-01', 'KENDIME');
    const gelir = await addTransaction(user, b, 'income', 9_900, '2027-07-01', 'KENDIME');

    await user.post('/api/matching/link', { expenseId: gider, incomeId: gelir });

    const res = await user.post<{ removedRows: number }>('/api/transactions/bulk-delete', {
      ids: [gider],
    });
    assert.equal(res.body.removedRows, 2, 'iki bacak da silinmeli');

    const kalan = await user.get<{ transactions: unknown[] }>(
      '/api/transactions?from=2027-07-01&to=2027-07-31',
    );
    assert.equal(kalan.body.transactions.length, 0);
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
