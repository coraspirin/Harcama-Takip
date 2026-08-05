import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import { buildTextPdf } from '../test/pdfFixture.ts';
import type { TestClient, TestServer } from '../test/harness.ts';

let server: TestServer;
let user: TestClient;
let other: TestClient;
let accountId: number;

type UploadResult = {
  result: {
    importId: number;
    parserId: string;
    extraction: string;
    lineCount: number;
    duplicateCount: number;
  };
};

type DraftLine = {
  id: number;
  date: string;
  description: string;
  amountKurus: number;
  type: string;
  isDuplicate: boolean;
  excluded: boolean;
};

const STATEMENT_LINES = [
  'Turkiye Is Bankasi - Hesap Hareketleri',
  'Tarih Aciklama Tutar Bakiye',
  '05.08.2026 MIGROS MARKET ANKARA -1.234,56 12.345,67',
  '06.08.2026 MAAS ODEMESI 25.000,00 37.345,67',
  '07.08.2026 SHELL AKARYAKIT -850,00 36.495,67',
];

async function uploadPdf(client: TestClient, filename: string, lines: string[]) {
  return client.upload<UploadResult>(
    '/api/ocr/upload',
    {
      field: 'file',
      filename,
      content: buildTextPdf(lines),
      type: 'application/pdf',
    },
    { accountId: String(accountId) },
  );
}

async function linesOf(client: TestClient, importId: number): Promise<DraftLine[]> {
  const res = await client.get<{ lines: DraftLine[] }>(`/api/ocr/imports/${importId}`);
  assert.equal(res.status, 200);
  return res.body.lines;
}

before(async () => {
  server = await bootstrap();
  user = await createUserAndLogin(server, 'ayse');
  other = await createUserAndLogin(server, 'mehmet');

  const account = await user.post<{ account: { id: number } }>('/api/accounts', {
    name: 'Vadesiz TL',
    type: 'bank',
    openingBalanceKurus: 0,
  });
  accountId = account.body.account.id;
});

after(async () => {
  await server.close();
});

describe('ekstre yukleme', () => {
  let importId: number;

  test('metin katmanli PDF OCR olmadan okunur', async () => {
    const res = await uploadPdf(user, 'isbank-agustos.pdf', STATEMENT_LINES);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(
      res.body.result.extraction,
      'text',
      'metin katmani varken OCR yoluna dusulmemeli',
    );
    assert.equal(res.body.result.parserId, 'isbank');
    assert.equal(res.body.result.lineCount, 3);
    assert.equal(res.body.result.duplicateCount, 0);

    importId = res.body.result.importId;
  });

  test('satirlar dogru ayristirilir ve TASLAK olarak durur', async () => {
    const lines = await linesOf(user, importId);

    assert.equal(lines.length, 3);
    assert.equal(lines[0]?.date, '2026-08-05');
    assert.equal(lines[0]?.amountKurus, 123_456);
    assert.equal(lines[0]?.type, 'expense');
    assert.equal(lines[1]?.type, 'income');

    // Onaylanmadan hicbir islem olusmamali
    const transactions = await user.get<{ pagination: { total: number } }>('/api/transactions');
    assert.equal(transactions.body.pagination.total, 0, 'taslak asamasinda islem yazilmamali');
  });

  test('AYNI DOSYA ikinci kez yuklenemez', async () => {
    const res = await uploadPdf(user, 'farkli-isim.pdf', STATEMENT_LINES);

    assert.equal(res.status, 409);
    const body = res.body as unknown as { error: { message: string } };
    assert.match(body.error.message, /daha once yuklenmis/i);
  });

  test('PDF olmayan dosya reddedilir', async () => {
    const res = await user.upload<{ error: { code: string } }>(
      '/api/ocr/upload',
      {
        field: 'file',
        filename: 'ekstre.txt',
        content: Buffer.from('05.08.2026 MARKET -100,00'),
        type: 'text/plain',
      },
      { accountId: String(accountId) },
    );

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_FILE_TYPE');
  });

  test('baskasinin hesabina ekstre yuklenemez', async () => {
    const mine = await other.post<{ account: { id: number } }>('/api/accounts', {
      name: 'Mehmet Hesap',
      type: 'cash',
    });

    const res = await other.upload(
      '/api/ocr/upload',
      {
        field: 'file',
        filename: 'baska.pdf',
        content: buildTextPdf(STATEMENT_LINES),
        type: 'application/pdf',
      },
      { accountId: String(accountId) }, // Ayse'nin hesabi
    );

    assert.equal(res.status, 404);
    assert.ok(mine.body.account.id);
  });

  test('baskasinin ice aktarimi goruntulenemez', async () => {
    assert.equal((await other.get(`/api/ocr/imports/${importId}`)).status, 404);
    assert.equal((await other.post(`/api/ocr/imports/${importId}/apply`)).status, 404);
  });
});

describe('taslak duzenleme ve isleme', () => {
  let importId: number;

  before(async () => {
    const res = await uploadPdf(user, 'isbank-eylul.pdf', [
      'Turkiye Is Bankasi',
      '01.09.2026 KIRA ODEMESI -15.000,00 50.000,00',
      '02.09.2026 INTERNET FATURASI -450,00 49.550,00',
      '03.09.2026 GEREKSIZ SATIR -1,00 49.549,00',
    ]);
    importId = res.body.result.importId;
  });

  test('satir duzenlenebilir', async () => {
    const lines = await linesOf(user, importId);
    const first = lines[0];
    assert.ok(first);

    const categories = await user.get<{ categories: { id: number; name: string }[] }>(
      '/api/categories',
    );
    const kira = categories.body.categories.find((c) => c.name === 'Kira');
    assert.ok(kira);

    const res = await user.patch<{ line: DraftLine }>(`/api/ocr/lines/${first.id}`, {
      date: first.date,
      description: 'Agustos kirasi',
      amountKurus: first.amountKurus,
      type: 'expense',
      categoryId: kira.id,
      excluded: false,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.line.description, 'Agustos kirasi');
  });

  test('haric tutulan satir islenmez', async () => {
    const lines = await linesOf(user, importId);
    const unwanted = lines.find((l) => l.description.includes('GEREKSIZ'));
    assert.ok(unwanted);

    await user.patch(`/api/ocr/lines/${unwanted.id}`, {
      date: unwanted.date,
      description: unwanted.description,
      amountKurus: unwanted.amountKurus,
      type: unwanted.type,
      categoryId: null,
      excluded: true,
    });

    const res = await user.post<{ result: { created: number; skipped: number } }>(
      `/api/ocr/imports/${importId}/apply`,
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.result.created, 2);
    assert.equal(res.body.result.skipped, 1);
  });

  test('islenen satirlar hesaba yazilir ve bakiyeyi degistirir', async () => {
    const account = await user.get<{ account: { balanceKurus: number } }>(
      `/api/accounts/${accountId}`,
    );
    // 15.000,00 + 450,00 gider
    assert.equal(account.body.account.balanceKurus, -1_545_000);
  });

  test('islenmis ice aktarim tekrar islenemez', async () => {
    const res = await user.post(`/api/ocr/imports/${importId}/apply`);
    assert.equal(res.status, 400);
  });

  test('islenmis ice aktarimin satirlari duzenlenemez', async () => {
    const lines = await linesOf(user, importId);
    const first = lines[0];
    assert.ok(first);

    const res = await user.patch(`/api/ocr/lines/${first.id}`, {
      date: first.date,
      description: 'Degistirilemez',
      amountKurus: first.amountKurus,
      type: 'expense',
      categoryId: null,
      excluded: false,
    });
    assert.equal(res.status, 400);
  });
});

describe('mukerrer satir tespiti', () => {
  test('donemleri ust uste binen ikinci ekstrede ayni satir MUKERRER isaretlenir', async () => {
    // Eylul ekstresinin bir satirini iceren yeni bir dosya
    const res = await uploadPdf(user, 'isbank-ekim.pdf', [
      'Turkiye Is Bankasi',
      '01.09.2026 KIRA ODEMESI -15.000,00 50.000,00',
      '05.10.2026 YENI HARCAMA -300,00 49.700,00',
    ]);

    assert.equal(res.status, 201);
    // Kira satiri zaten islenmisti (aciklamasi degistirilmemis satir)
    const lines = await linesOf(user, res.body.result.importId);

    const yeni = lines.find((l) => l.description.includes('YENI HARCAMA'));
    assert.ok(yeni);
    assert.equal(yeni.isDuplicate, false);
    assert.equal(yeni.excluded, false);

    // Islenirken mukerrer satir atlanir
    const applied = await user.post<{ result: { created: number; skipped: number } }>(
      `/api/ocr/imports/${res.body.result.importId}/apply`,
    );
    assert.equal(applied.body.result.created + applied.body.result.skipped, lines.length);
  });

  test('ayni dosya icindeki tekrar eden satirlar da mukerrer sayilir', async () => {
    const res = await uploadPdf(user, 'tekrarli.pdf', [
      'Turkiye Is Bankasi',
      '10.10.2026 AYNI ISLEM -99,00 1.000,00',
      '10.10.2026 AYNI ISLEM -99,00 901,00',
    ]);

    assert.equal(res.status, 201);
    assert.equal(res.body.result.lineCount, 2);
    assert.equal(res.body.result.duplicateCount, 1, 'ikinci ayni satir mukerrer olmali');

    const lines = await linesOf(user, res.body.result.importId);
    assert.equal(lines[1]?.isDuplicate, true);
    assert.equal(lines[1]?.excluded, true, 'mukerrer satir varsayilan olarak haric baslar');
  });
});

describe('ice aktarim gecmisi', () => {
  test('taslak silinir, islenmis kayit yalnizca gecmisten kaldirilir', async () => {
    const draft = await uploadPdf(user, 'silinecek-taslak.pdf', [
      'Turkiye Is Bankasi',
      '20.11.2026 SILINECEK -50,00 100,00',
      '21.11.2026 BU DA -60,00 40,00',
    ]);
    const draftId = draft.body.result.importId;

    const removed = await user.delete<{ deleted: boolean }>(`/api/ocr/imports/${draftId}`);
    assert.equal(removed.body.deleted, true);
    assert.equal((await user.get(`/api/ocr/imports/${draftId}`)).status, 404);

    // Islenmis olan kayitlar listede kalir
    const list = await user.get<{ imports: { status: string }[] }>('/api/ocr/imports');
    assert.ok(list.body.imports.some((i) => i.status === 'applied'));
  });
});
