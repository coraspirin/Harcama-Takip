import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin, loginAdmin } from '../test/fixtures.ts';
import type { TestClient, TestServer } from '../test/harness.ts';
import { addDays, todayIso } from '../lib/date.ts';

let server: TestServer;
let ayse: TestClient;
let mehmet: TestClient;
let yeni: TestClient;
const ids: Record<string, number> = {};

type Cat = { id: number; name: string; kind: string };

async function categoryIds(client: TestClient): Promise<Record<string, number>> {
  const res = await client.get<{ categories: Cat[] }>('/api/categories');
  return Object.fromEntries(res.body.categories.map((c) => [c.name, c.id]));
}

async function add(client: TestClient, body: Record<string, unknown>) {
  const res = await client.post('/api/transactions', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
}

type Yearly = {
  year: number;
  isCurrentYear: boolean;
  monthsElapsed: number;
  totals: {
    incomeKurus: number;
    expenseKurus: number;
    netKurus: number;
    savingsRatePercent: number | null;
  };
  previousYear: { incomeKurus: number; expenseKurus: number; netKurus: number } | null;
  changePercent: { income: number | null; expense: number | null; net: number | null };
  months: { month: string; incomeKurus: number; expenseKurus: number; netKurus: number }[];
  expenseByCategory: {
    categoryId: number | null;
    categoryName: string;
    totalKurus: number;
    sharePercent: number;
    transactionCount: number;
    previousYearKurus: number;
    changePercent: number | null;
  }[];
  incomeByCategory: Yearly['expenseByCategory'];
  highlights: {
    highestExpenseMonth: { month: string; expenseKurus: number } | null;
    lowestExpenseMonth: { month: string; expenseKurus: number } | null;
    averageMonthlyExpenseKurus: number;
    averageMonthlyIncomeKurus: number;
  };
  expenseByNature: { fixedKurus: number; variableKurus: number; uncategorizedKurus: number };
};

before(async () => {
  server = await bootstrap();
  ayse = await createUserAndLogin(server, 'ayse');
  mehmet = await createUserAndLogin(server, 'mehmet');
  yeni = await createUserAndLogin(server, 'yeni');
  Object.assign(ids, await categoryIds(ayse));

  // --- 2023 (onceki yil): gelir 1000, gider 400 (Market 300, Kira 100)
  await add(ayse, {
    type: 'income',
    categoryId: ids.Maas,
    amountKurus: 100_000,
    date: '2023-03-01',
  });
  await add(ayse, {
    type: 'expense',
    categoryId: ids.Market,
    amountKurus: 30_000,
    date: '2023-03-05',
  });
  await add(ayse, {
    type: 'expense',
    categoryId: ids.Kira,
    amountKurus: 10_000,
    date: '2023-04-05',
  });

  // --- 2024: gelir 2000, gider 1000
  await add(ayse, {
    type: 'income',
    categoryId: ids.Maas,
    amountKurus: 200_000,
    date: '2024-01-01',
  });
  await add(ayse, {
    type: 'expense',
    categoryId: ids.Market,
    amountKurus: 60_000,
    date: '2024-01-10',
  });
  await add(ayse, {
    type: 'expense',
    categoryId: ids.Market,
    amountKurus: 10_000,
    date: '2024-06-10',
  });
  await add(ayse, {
    type: 'expense',
    categoryId: ids.Kira,
    amountKurus: 20_000,
    date: '2024-06-12',
  });
  await add(ayse, { type: 'expense', categoryId: null, amountKurus: 10_000, date: '2024-12-31' });

  // Baska kullanicinin 2024 verisi sonuca girmemeli
  const mIds = await categoryIds(mehmet);
  await add(mehmet, {
    type: 'income',
    categoryId: mIds.Maas,
    amountKurus: 999_999,
    date: '2024-01-02',
  });
  await add(mehmet, {
    type: 'expense',
    categoryId: mIds.Market,
    amountKurus: 888_888,
    date: '2024-06-02',
  });
});

after(async () => {
  await server.close();
});

describe('GET /api/reports/yearly', () => {
  test('bos yil: 12 sifir ay, previousYear null, highlights null', async () => {
    const res = await yeni.get<Yearly>('/api/reports/yearly?year=2024');
    assert.equal(res.status, 200);
    const b = res.body;
    assert.equal(b.year, 2024);
    assert.equal(b.months.length, 12);
    assert.equal(b.months[0]?.month, '2024-01');
    assert.equal(b.months[11]?.month, '2024-12');
    assert.ok(
      b.months.every((m) => m.incomeKurus === 0 && m.expenseKurus === 0 && m.netKurus === 0),
    );
    assert.equal(b.previousYear, null);
    assert.deepEqual(b.changePercent, { income: null, expense: null, net: null });
    assert.equal(b.totals.savingsRatePercent, null);
    assert.equal(b.highlights.highestExpenseMonth, null);
    assert.equal(b.highlights.lowestExpenseMonth, null);
    assert.deepEqual(b.expenseByCategory, []);
    assert.deepEqual(b.expenseByNature, { fixedKurus: 0, variableKurus: 0, uncategorizedKurus: 0 });
  });

  test('ornek veri: toplamlar, aylar, kategoriler, onceki yil, tasarruf orani, nitelik', async () => {
    const res = await ayse.get<Yearly>('/api/reports/yearly?year=2024');
    assert.equal(res.status, 200);
    const b = res.body;

    assert.equal(b.isCurrentYear, false);
    assert.equal(b.monthsElapsed, 12);
    assert.deepEqual(b.totals, {
      incomeKurus: 200_000,
      expenseKurus: 100_000,
      netKurus: 100_000,
      savingsRatePercent: 50,
    });
    assert.deepEqual(b.previousYear, {
      incomeKurus: 100_000,
      expenseKurus: 40_000,
      netKurus: 60_000,
    });
    assert.equal(b.changePercent.income, 100);
    assert.equal(b.changePercent.expense, 150);
    assert.ok(Math.abs((b.changePercent.net ?? 0) - 66.666) < 0.01);

    assert.equal(b.months[0]?.incomeKurus, 200_000);
    assert.equal(b.months[0]?.expenseKurus, 60_000);
    assert.equal(b.months[0]?.netKurus, 140_000);
    assert.equal(b.months[5]?.expenseKurus, 30_000);
    assert.equal(b.months[11]?.expenseKurus, 10_000);
    assert.equal(b.months[2]?.expenseKurus, 0);

    const names = b.expenseByCategory.map((c) => c.categoryName);
    assert.deepEqual(names, ['Market', 'Kira', 'Kategorisiz']);
    const market = b.expenseByCategory[0]!;
    assert.equal(market.totalKurus, 70_000);
    assert.equal(market.transactionCount, 2);
    assert.equal(market.sharePercent, 70);
    assert.equal(market.previousYearKurus, 30_000);
    assert.ok(Math.abs((market.changePercent ?? 0) - 133.333) < 0.01);
    const kira = b.expenseByCategory[1]!;
    assert.equal(kira.previousYearKurus, 10_000);
    assert.equal(kira.changePercent, 100);
    const none = b.expenseByCategory[2]!;
    assert.equal(none.categoryId, null);
    assert.equal(none.previousYearKurus, 0);
    assert.equal(none.changePercent, null);

    assert.equal(b.incomeByCategory.length, 1);
    assert.equal(b.incomeByCategory[0]?.categoryName, 'Maas');
    assert.equal(b.incomeByCategory[0]?.previousYearKurus, 100_000);

    assert.deepEqual(b.highlights.highestExpenseMonth, { month: '2024-01', expenseKurus: 60_000 });
    assert.deepEqual(b.highlights.lowestExpenseMonth, { month: '2024-12', expenseKurus: 10_000 });
    assert.equal(b.highlights.averageMonthlyExpenseKurus, Math.round(100_000 / 12));
    assert.equal(b.highlights.averageMonthlyIncomeKurus, Math.round(200_000 / 12));

    assert.deepEqual(b.expenseByNature, {
      fixedKurus: 20_000,
      variableKurus: 70_000,
      uncategorizedKurus: 10_000,
    });
  });

  test('varsayilan yil cari yil; monthsElapsed bugunun ayi; gelecek yil 0', async () => {
    const today = todayIso();
    const res = await ayse.get<Yearly>('/api/reports/yearly');
    assert.equal(res.status, 200);
    assert.equal(res.body.year, Number(today.slice(0, 4)));
    assert.equal(res.body.isCurrentYear, true);
    assert.equal(res.body.monthsElapsed, Number(today.slice(5, 7)));

    const future = await ayse.get<Yearly>('/api/reports/yearly?year=2100');
    assert.equal(future.body.monthsElapsed, 0);
    assert.equal(future.body.highlights.averageMonthlyExpenseKurus, 0);
  });

  test('baska kullanicinin verisi dahil degil', async () => {
    const res = await mehmet.get<Yearly>('/api/reports/yearly?year=2024');
    assert.equal(res.body.totals.incomeKurus, 999_999);
    assert.equal(res.body.totals.expenseKurus, 888_888);
    assert.equal(res.body.previousYear, null);
  });

  test('gecersiz year 400', async () => {
    for (const y of ['1999', '2101', 'abc', '2024.5']) {
      const res = await ayse.get<{ error: { code: string } }>(`/api/reports/yearly?year=${y}`);
      assert.equal(res.status, 400, y);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
  });
});

describe('GET /api/transactions/suggest-category', () => {
  type Suggest = {
    suggestions: {
      categoryId: number;
      categoryName: string;
      confidence: number;
      matchCount: number;
    }[];
  };
  const q = (d: string, type = 'expense') =>
    `/api/transactions/suggest-category?description=${encodeURIComponent(d)}&type=${type}`;

  before(async () => {
    const today = todayIso();
    const day = (n: number) => addDays(today, -n);

    await add(ayse, {
      type: 'expense',
      categoryId: ids.Market,
      amountKurus: 1_000,
      date: day(5),
      description: 'Migros',
    });
    await add(ayse, {
      type: 'expense',
      categoryId: ids.Market,
      amountKurus: 1_000,
      date: day(20),
      description: 'MIGROS 456',
    });
    await add(ayse, {
      type: 'expense',
      categoryId: ids.Yemek,
      amountKurus: 1_000,
      date: day(30),
      description: 'Migros kafe',
    });
    await add(ayse, {
      type: 'expense',
      categoryId: ids.Ulasim,
      amountKurus: 1_000,
      date: day(10),
      description: 'Shell benzin',
    });
    await add(ayse, {
      type: 'income',
      categoryId: ids.Maas,
      amountKurus: 1_000,
      date: day(10),
      description: 'Migros iade',
    });
    // Eski (365 gunden once): oneride yok sayilmali
    await add(ayse, {
      type: 'expense',
      categoryId: ids.Giyim,
      amountKurus: 1_000,
      date: day(400),
      description: 'Zara giyim',
    });
    // Arsivlenecek kategori
    await add(ayse, {
      type: 'expense',
      categoryId: ids.Eglence,
      amountKurus: 1_000,
      date: day(3),
      description: 'Sinema bileti',
    });
    const del = await ayse.delete<{ action: string }>(`/api/categories/${ids.Eglence}`);
    assert.equal(del.body.action, 'archived');

    // Baska kullanici ayni aciklamayla baska kategoriye cok islem girer
    const mIds = await categoryIds(mehmet);
    for (let i = 0; i < 5; i++) {
      await add(mehmet, {
        type: 'expense',
        categoryId: mIds.Saglik,
        amountKurus: 1_000,
        date: day(i + 1),
        description: 'Migros',
      });
    }
  });

  test('birebir eslesme en ustte, Turkce karakter/buyuk harf/rakam farki eslesir', async () => {
    const res = await ayse.get<Suggest>(q('MİGROS 123'));
    assert.equal(res.status, 200);
    const s = res.body.suggestions;
    assert.equal(s[0]?.categoryName, 'Market');
    assert.equal(s[0]?.matchCount, 2); // 'Migros' ve 'MIGROS 456'
    assert.ok(s.length <= 3);
    // Market: 2 birebir x3 x1.5 = 9 ; Yemek: jaccard 0.5 (1) + ilk token 0.5 = 1.5 x1.5 = 2.25
    assert.equal(s[0]?.confidence, Math.round((9 / 11.25) * 100) / 100);
    assert.equal(s[1]?.categoryName, 'Yemek');
    assert.equal(s[1]?.confidence, Math.round((2.25 / 11.25) * 100) / 100);
    assert.ok(s.every((x) => x.categoryName !== 'Maas'));
  });

  test('type ayrimi: gelirde yalnizca gelir kategorileri', async () => {
    const res = await ayse.get<Suggest>(q('migros', 'income'));
    assert.deepEqual(
      res.body.suggestions.map((x) => x.categoryName),
      ['Maas'],
    );
    assert.equal(res.body.suggestions[0]?.confidence, 1);
  });

  test('arsivlenmis kategori onerilmez; 365 gunden eski islem sayilmaz', async () => {
    const archived = await ayse.get<Suggest>(q('Sinema bileti'));
    assert.deepEqual(archived.body.suggestions, []);
    const old = await ayse.get<Suggest>(q('Zara giyim'));
    assert.deepEqual(old.body.suggestions, []);
  });

  test('baska kullanicinin islemleri etkilemez', async () => {
    const res = await yeni.get<Suggest>(q('Migros'));
    assert.deepEqual(res.body.suggestions, []);
    const mine = await ayse.get<Suggest>(q('Migros'));
    assert.ok(mine.body.suggestions.every((x) => x.categoryName !== 'Saglik'));
  });

  test('kisa aciklama bos liste (400 degil); eksik/uzun parametre 400', async () => {
    const short = await ayse.get<Suggest>(q('a'));
    assert.equal(short.status, 200);
    assert.deepEqual(short.body.suggestions, []);
    const blank = await ayse.get<Suggest>(q('   '));
    assert.deepEqual(blank.body.suggestions, []);

    const noType = await ayse.get('/api/transactions/suggest-category?description=migros');
    assert.equal(noType.status, 400);
    const noDesc = await ayse.get('/api/transactions/suggest-category?type=expense');
    assert.equal(noDesc.status, 400);
    const long = await ayse.get(q('a'.repeat(201)));
    assert.equal(long.status, 400);
  });
});

describe('GET /api/transactions/recent-categories', () => {
  type Recent = {
    categories: {
      categoryId: number;
      categoryName: string;
      useCount: number;
      lastUsedAt: string | null;
    }[];
  };
  let tutku: TestClient;

  before(async () => {
    tutku = await createUserAndLogin(server, 'tutku');
    const t = await categoryIds(tutku);
    const today = todayIso();
    const day = (n: number) => addDays(today, -n);
    const rows: [string, number][] = [
      ['Market', 2],
      ['Market', 9],
      ['Market', 4],
      ['Yemek', 1],
      ['Yemek', 8],
      ['Kira', 3],
      ['Fatura', 6],
      ['Ulasim', 120], // 90 gunden eski
    ];
    for (const [name, ago] of rows) {
      await add(tutku, { type: 'expense', categoryId: t[name], amountKurus: 100, date: day(ago) });
    }
  });

  test('kullanim sayisi azalan, esitlikte son kullanim azalan', async () => {
    const today = todayIso();
    const res = await tutku.get<Recent>('/api/transactions/recent-categories?type=expense');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.categories.map((c) => [c.categoryName, c.useCount]),
      [
        ['Market', 3],
        ['Yemek', 2],
        ['Kira', 1],
        ['Fatura', 1],
      ],
    );
    assert.equal(res.body.categories[0]?.lastUsedAt, addDays(today, -2));
    assert.equal(res.body.categories[2]?.lastUsedAt, addDays(today, -3));
  });

  test('limit uygulanir; gecersiz limit/type 400', async () => {
    const res = await tutku.get<Recent>('/api/transactions/recent-categories?type=expense&limit=2');
    assert.equal(res.body.categories.length, 2);
    for (const qs of ['type=expense&limit=0', 'type=expense&limit=13', 'limit=3', 'type=x']) {
      const bad = await tutku.get(`/api/transactions/recent-categories?${qs}`);
      assert.equal(bad.status, 400, qs);
    }
  });

  test('yeni kullanici: arsivlenmemis kategoriler ada gore, useCount 0', async () => {
    const res = await yeni.get<Recent>('/api/transactions/recent-categories?type=income&limit=12');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.categories.map((c) => c.categoryName),
      ['Diger gelir', 'Ek gelir', 'Maas', 'Yatirim geliri'],
    );
    assert.ok(res.body.categories.every((c) => c.useCount === 0 && c.lastUsedAt === null));

    const expense = await yeni.get<Recent>('/api/transactions/recent-categories?type=expense');
    assert.equal(expense.body.categories.length, 6);
  });

  test('baska kullanicinin kullanimi sayilmaz; arsivlenmis kategori donmez', async () => {
    const res = await mehmet.get<Recent>('/api/transactions/recent-categories?type=expense');
    assert.deepEqual(
      res.body.categories.map((c) => [c.categoryName, c.useCount]),
      [['Saglik', 5]],
    );
    const mine = await ayse.get<Recent>(
      '/api/transactions/recent-categories?type=expense&limit=12',
    );
    assert.ok(mine.body.categories.every((c) => c.categoryName !== 'Eglence'));
  });
});

describe('yetki', () => {
  test('super admin yeni uclara erisemez', async () => {
    const admin = await loginAdmin(server);
    for (const path of [
      '/api/reports/yearly?year=2024',
      '/api/transactions/suggest-category?description=migros&type=expense',
      '/api/transactions/recent-categories?type=expense',
    ]) {
      const res = await admin.get<{ error: { code: string } }>(path);
      assert.equal(res.status, 403, path);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
  });
});
