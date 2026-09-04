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
    skippedByDateCount: number;
    balanceCheck: 'ok' | 'gaps' | 'unavailable';
    balanceGapCount: number;
    balanceGapKurus: number;
    statementBalanceKurus: number | null;
    unmappedLabels: string[];
  };
};

type DraftLine = {
  id: number;
  date: string;
  description: string;
  amountKurus: number;
  type: string;
  categoryId: number | null;
  label: string | null;
  balanceKurus: number | null;
  chainBreak: boolean;
  excluded: boolean;
};

const STATEMENT_LINES = [
  'Turkiye Is Bankasi - Hesap Hareketleri',
  'Tarih Aciklama Tutar Bakiye',
  '05.08.2026 MIGROS MARKET ANKARA -1.234,56 12.345,67',
  '06.08.2026 MAAS ODEMESI 25.000,00 37.345,67',
  '07.08.2026 SHELL AKARYAKIT -850,00 36.495,67',
];

async function uploadPdf(
  client: TestClient,
  filename: string,
  lines: string[],
  targetAccountId: number = accountId,
) {
  return client.upload<UploadResult>(
    '/api/ocr/upload',
    {
      field: 'file',
      filename,
      content: buildTextPdf(lines),
      type: 'application/pdf',
    },
    { accountId: String(targetAccountId) },
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

describe('mukerrer bastirma YAPILMAZ', () => {
  test('ayni dosya icindeki tekrarlarin ikisi de yazilir', () => {
    // Hesap hareketlerinde ayni gun, ayni tutarda, ayni aciklamayla birden
    // fazla islem olagandir; otomatik elemek gercek harcamayi kaybettirir.
    return (async () => {
      const res = await uploadPdf(user, 'tekrarli.pdf', [
        'Turkiye Is Bankasi',
        '10.10.2026 AYNI ISLEM -99,00 1.000,00',
        '10.10.2026 AYNI ISLEM -99,00 901,00',
      ]);

      assert.equal(res.body.result.lineCount, 2);

      const lines = await linesOf(user, res.body.result.importId);
      assert.ok(
        lines.every((l) => !l.excluded),
        'hicbir satir kendiliginden haric tutulmamali',
      );

      const applied = await user.post<{ result: { created: number; skipped: number } }>(
        `/api/ocr/imports/${res.body.result.importId}/apply`,
      );
      assert.equal(applied.body.result.created, 2);
      assert.equal(applied.body.result.skipped, 0);
    })();
  });

  test('ortusen donemli ikinci ekstre de tam yazilir', async () => {
    // Ayni satirlar ikinci kez gelirse ELENMEZ. Yanlislikla iki kez aktarilan
    // bir ekstre, ice aktarim gecmisinden silinerek geri alinir.
    const res = await uploadPdf(user, 'ortusen.pdf', [
      'Turkiye Is Bankasi',
      '11.10.2026 ORTUSEN ISLEM -55,00 500,00',
    ]);
    await user.post(`/api/ocr/imports/${res.body.result.importId}/apply`);

    const ikinci = await uploadPdf(user, 'ortusen-2.pdf', [
      'Turkiye Is Bankasi - ikinci kopya',
      '11.10.2026 ORTUSEN ISLEM -55,00 500,00',
    ]);
    const applied = await user.post<{ result: { created: number } }>(
      `/api/ocr/imports/${ikinci.body.result.importId}/apply`,
    );

    assert.equal(applied.body.result.created, 1, 'UNIQUE indekse takilmadan yazilmali');
  });
});

describe('ice aktarim gecmisi', () => {
  test('taslak silinir', async () => {
    const draft = await uploadPdf(user, 'silinecek-taslak.pdf', [
      'Turkiye Is Bankasi',
      '20.11.2026 SILINECEK -50,00 100,00',
      '21.11.2026 BU DA -60,00 40,00',
    ]);
    const draftId = draft.body.result.importId;

    const removed = await user.delete<{ deleted: boolean; removedTransactions: number }>(
      `/api/ocr/imports/${draftId}`,
    );
    assert.equal(removed.body.deleted, true);
    assert.equal(removed.body.removedTransactions, 0, 'taslakta islem olusmamisti');
    assert.equal((await user.get(`/api/ocr/imports/${draftId}`)).status, 404);
  });

  test('ISLENMIS ice aktarim silinince islemleri de kalkar', async () => {
    // Eskiden yalnizca 'discarded' isaretleniyor, islemler yerinde kaliyordu;
    // kullanici "kaldir" dedigi halde veri duruyordu.
    const res = await uploadPdf(user, 'islenmis-silinecek.pdf', [
      'Turkiye Is Bankasi',
      '22.11.2026 GERI ALINACAK -70,00 30,00',
    ]);
    const importId = res.body.result.importId;

    await user.post(`/api/ocr/imports/${importId}/apply`);

    const before = await user.get<{ pagination: { total: number } }>('/api/transactions');
    const impact = await user.get<{ transactionCount: number }>(
      `/api/ocr/imports/${importId}/impact`,
    );
    assert.equal(impact.body.transactionCount, 1, 'silmeden once etki gosterilebilmeli');

    const removed = await user.delete<{ deleted: boolean; removedTransactions: number }>(
      `/api/ocr/imports/${importId}`,
    );
    assert.equal(removed.body.removedTransactions, 1);

    const after = await user.get<{ pagination: { total: number } }>('/api/transactions');
    assert.equal(
      before.body.pagination.total - after.body.pagination.total,
      1,
      'olusan islem gercekten silinmeli',
    );
    assert.equal((await user.get(`/api/ocr/imports/${importId}`)).status, 404);
  });

  test('baskasinin ice aktarimi silinemez', async () => {
    const mine = await uploadPdf(user, 'benim-silinmez.pdf', [
      'Turkiye Is Bankasi',
      '23.11.2026 BENIM -10,00 20,00',
    ]);
    const res = await other.delete(`/api/ocr/imports/${mine.body.result.importId}`);
    assert.equal(res.status, 404);
  });
});

/**
 * Ayni icerikli PDF ikinci kez yuklenemez (dosya SHA-256'si tekil). Testler
 * ayni duzeni birden fazla kez kullandigi icin her cagriya benzersiz bir
 * baslik satiri eklenir.
 */
function garantiLines(marker: string): string[] {
  return [
    `T. Garanti Bankası A.Ş. - ${marker}`,
    'Tarih Açıklama Etiket Tutar Bakiye',
    '05.03.2027 TELEKOM FATURASI Telekomünikasyon -820,00 TL -5.820,00 TL',
    '04.03.2027 DOGALGAZ Kurum Ödemesi -136,00 TL -5.000,00 TL',
    '03.03.2027 KIRA MART Kira Ödemesi -1.000,00 TL -4.864,00 TL',
  ];
}

describe('bakiye zinciri ve etiketler (uctan uca)', () => {
  test('zincir sonucu ve ekstre bakiyesi doner', async () => {
    const res = await uploadPdf(user, 'garanti-zincir.pdf', garantiLines('zincir'));

    assert.equal(res.body.result.balanceCheck, 'ok');
    assert.equal(res.body.result.balanceGapCount, 0);
    assert.equal(
      res.body.result.statementBalanceKurus,
      -582_000,
      'ekstrenin en yeni bakiyesi mutabakat icin donmeli',
    );
  });

  test('etiketler satirlara yazilir ve eslenmemis olanlar bildirilir', async () => {
    const res = await uploadPdf(user, 'garanti-etiket.pdf', garantiLines('etiket'));
    const lines = await linesOf(user, res.body.result.importId);

    const telekom = lines.find((l) => l.description.includes('TELEKOM'));
    assert.equal(telekom?.label, 'Telekomünikasyon');
    assert.equal(telekom?.description, 'TELEKOM FATURASI');
    assert.equal(telekom?.categoryId, null, 'eslesmemis etiket kategorisiz kalir');

    assert.ok(res.body.result.unmappedLabels.includes('Telekomünikasyon'));
  });

  test('etiket bir kez eslenince sonraki ice aktarimda HATIRLANIR', async () => {
    const category = await user.post<{ category: { id: number } }>('/api/categories', {
      name: 'Telekom Gideri',
      kind: 'expense',
    });

    const saved = await user.put('/api/ocr/label-map', {
      parserId: 'garanti',
      label: 'Telekomünikasyon',
      categoryId: category.body.category.id,
    });
    assert.equal(saved.status, 200);

    const res = await uploadPdf(user, 'garanti-eslenmis.pdf', garantiLines('eslenmis'));
    const lines = await linesOf(user, res.body.result.importId);

    const telekom = lines.find((l) => l.description.includes('TELEKOM'));
    assert.equal(telekom?.categoryId, category.body.category.id, 'kategori otomatik atanmali');
    assert.ok(!res.body.result.unmappedLabels.includes('Telekomünikasyon'));
  });

  test('kopuk zincir satiri isaretlenir', async () => {
    const bozuk = garantiLines('kopuk').filter((line) => !line.includes('DOGALGAZ'));
    const res = await uploadPdf(user, 'garanti-kopuk.pdf', bozuk);

    assert.equal(res.body.result.balanceCheck, 'gaps');
    assert.equal(res.body.result.balanceGapKurus, 13_600, 'kayip tutar bildirilmeli');

    const lines = await linesOf(user, res.body.result.importId);
    assert.ok(lines.some((l) => l.chainBreak), 'kopuklugun dustugu satir isaretlenmeli');
  });
});

describe('tarih kesme ve toplu islemler', () => {
  test('kesme tarihinden onceki satirlar alinmaz', async () => {
    const res = await user.upload<UploadResult>(
      '/api/ocr/upload',
      {
        field: 'file',
        filename: 'tarih-kesmeli.pdf',
        content: buildTextPdf([
          'Turkiye Is Bankasi',
          '01.01.2027 ESKI HARCAMA -10,00 990,00',
          '01.06.2027 YENI HARCAMA -20,00 970,00',
        ]),
        type: 'application/pdf',
      },
      { accountId: String(accountId), fromDate: '2027-03-01' },
    );

    assert.equal(res.body.result.lineCount, 1);
    assert.equal(res.body.result.skippedByDateCount, 1);

    const lines = await linesOf(user, res.body.result.importId);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!.description, /YENI/);
  });

  test('toplu haric tutma ve kategori atama calisir', async () => {
    const res = await uploadPdf(user, 'toplu-islem.pdf', [
      'Turkiye Is Bankasi',
      '01.04.2027 BIR -10,00 990,00',
      '02.04.2027 IKI -20,00 970,00',
      '03.04.2027 UC -30,00 940,00',
    ]);
    const importId = res.body.result.importId;
    const lines = await linesOf(user, importId);
    const ids = lines.slice(0, 2).map((l) => l.id);

    const excluded = await user.post<{ updated: number }>(`/api/ocr/imports/${importId}/bulk`, {
      ids,
      action: 'exclude',
    });
    assert.equal(excluded.body.updated, 2);

    const after = await linesOf(user, importId);
    assert.equal(after.filter((l) => l.excluded).length, 2);
    assert.equal(after[2]?.excluded, false, 'secilmeyen satir etkilenmemeli');

    const category = await user.post<{ category: { id: number } }>('/api/categories', {
      name: 'Toplu Kategori',
      kind: 'expense',
    });
    await user.post(`/api/ocr/imports/${importId}/bulk`, {
      ids,
      action: 'setCategory',
      categoryId: category.body.category.id,
    });

    const categorized = await linesOf(user, importId);
    assert.equal(categorized[0]?.categoryId, category.body.category.id);
    assert.equal(categorized[2]?.categoryId, null);
  });

  test('baskasinin satiri toplu islemle degistirilemez', async () => {
    const mine = await uploadPdf(user, 'benim-taslagim.pdf', [
      'Turkiye Is Bankasi',
      '05.05.2027 BENIM -10,00 990,00',
    ]);
    const myLines = await linesOf(user, mine.body.result.importId);

    const res = await other.post(`/api/ocr/imports/${mine.body.result.importId}/bulk`, {
      ids: myLines.map((l) => l.id),
      action: 'exclude',
    });

    assert.equal(res.status, 404, 'baskasinin ice aktarimi bulunamamali');

    const unchanged = await linesOf(user, mine.body.result.importId);
    assert.equal(unchanged[0]?.excluded, false);
  });
});

/**
 * Okunamayan satirlar, kaybolan kayitlarin TEK kaniti.
 *
 * Bakiye zinciri "31 kopukluk var" dediginde eskiden hangi metnin
 * okunamadigini gorecek hicbir yol yoktu; sebep ancak canli veritabani
 * kazilarak daraltilabiliyordu.
 */
describe('okunamayan satirlar ice aktarimla birlikte saklanir', () => {
  test('cozulemeyen satir ham haliyle ve sebebiyle doner', async () => {
    const res = await uploadPdf(user, 'okunamayan.pdf', [
      'Turkiye Is Bankasi - okunamayan satir ornegi',
      'Tarih Aciklama Tutar Bakiye',
      '05.08.2026 MARKET -100,00 900,00',
      'DEVAM SATIRI TARIHSIZ -250,00 TL',
      '06.08.2026 TUTARSIZ SATIR ORNEGI',
    ]);

    assert.equal(res.body.result.unreadLineCount, 2);

    const detail = await user.get<{
      unreadLines: { seq: number; reason: string; raw: string }[];
    }>(`/api/ocr/imports/${res.body.result.importId}`);

    assert.equal(detail.status, 200);
    const sebepler = detail.body.unreadLines.map((line) => line.reason);
    assert.deepEqual(sebepler, ['tarih-yok', 'tutar-yok']);
    assert.match(detail.body.unreadLines[0]?.raw ?? '', /DEVAM SATIRI/);
  });

  test('temiz ekstrede okunamayan satir bildirilmez', async () => {
    const res = await uploadPdf(user, 'temiz-ekstre.pdf', [
      'Turkiye Is Bankasi - temiz ekstre ornegi',
      'Tarih Aciklama Tutar Bakiye',
      '05.08.2026 MARKET -100,00 900,00',
      '04.08.2026 BENZIN -200,00 1.000,00',
    ]);

    assert.equal(res.body.result.unreadLineCount, 0);
  });

  test('ice aktarim silinince okunamayan satirlar da kalkar', async () => {
    const res = await uploadPdf(user, 'silinecek-okunamayan.pdf', [
      'Turkiye Is Bankasi - silinecek ornek',
      'Tarih Aciklama Tutar Bakiye',
      '05.08.2026 MARKET -100,00 900,00',
      'TARIHSIZ ARTIK SATIR -50,00 TL',
    ]);
    assert.equal(res.body.result.unreadLineCount, 1);

    const silme = await user.delete(`/api/ocr/imports/${res.body.result.importId}`);
    assert.equal(silme.status, 200);

    const detail = await user.get(`/api/ocr/imports/${res.body.result.importId}`);
    assert.equal(detail.status, 404, 'ice aktarim ve bagli satirlari kalkmali');
  });
});
