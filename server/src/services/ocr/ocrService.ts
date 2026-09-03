import crypto from 'node:crypto';
import { getDb } from '../../db/connection.ts';
import { conflict } from '../../lib/errors.ts';
import {
  createImport,
  findImportByHash,
  insertDraftLine,
  listDraftLines,
  setBalanceCheck,
  setImportStatus,
} from '../../db/ocr.ts';
import { listLabelMap } from '../../db/labelMap.ts';
import { countContentMatches, insertTransaction, type ContentKey } from '../../db/transactions.ts';
import { detectParser, findParserById } from './parserRegistry.ts';
import { extractPdfText } from './textExtraction.ts';
import { checkBalanceChain } from './balanceChain.ts';
import { foldTurkish, type ParsedLine } from './statementParser.ts';

/**
 * Aciklamayi karsilastirma icin sadelestirir: bosluk farki ve Turkce
 * buyuk/kucuk harf donusumu parmak izini degistirmemeli.
 */
export function normalizeDescription(description: string): string {
  return foldTurkish(description).replace(/\s+/g, ' ').trim();
}

function contentKeyOf(accountId: number, line: ParsedLine): ContentKey {
  return {
    accountId,
    date: line.date,
    amountKurus: line.amountKurus,
    type: line.type,
    normalizedDescription: normalizeDescription(line.description),
  };
}

function contentKeyString(key: ContentKey): string {
  return [
    key.accountId,
    key.date,
    key.amountKurus,
    key.type,
    key.normalizedDescription,
  ].join('|');
}

/**
 * Bir islem satirinin PARMAK IZI.
 *
 * `occurrence`, ayni icerigin bu belgedeki KACINCI tekrari oldugudur ve
 * zorunludur: transactions tablosunda (user_id, external_hash) uzerinde UNIQUE
 * bir indeks var. Parmak izi yalnizca icerikten uretilseydi, ayni gun ayni
 * tutarda gercekten iki kez yapilmis bir islem veritabaninda BIR ARADA
 * DURAMAZDI - ikinci satir ya sessizce atlanir ya da tum ice aktarimi geri
 * alirdi.
 */
export function externalHash(userId: number, key: ContentKey, occurrence: number): string {
  return crypto
    .createHash('sha256')
    .update(`${userId}|${contentKeyString(key)}#${occurrence}`)
    .digest('hex');
}

export type ImportResult = {
  importId: number;
  parserId: string;
  parserName: string;
  extraction: 'text' | 'ocr';
  pageCount: number;
  lineCount: number;
  /** Ayristirildi ama tarih kesmesi yuzunden alinmadi. */
  skippedByDateCount: number;
  duplicateCount: number;
  balanceCheck: 'ok' | 'gaps' | 'unavailable';
  balanceGapCount: number;
  balanceGapKurus: number;
  /** Zincirin gercekten dogrulanabildigi / dogrulanamadigi gecis sayisi. */
  balanceCheckedPairs: number;
  balanceUncheckedPairs: number;
  /** Ekstredeki en yeni satirin bakiyesi; hesap mutabakati icin. */
  statementBalanceKurus: number | null;
  /** Kategoriye eslenememis banka etiketleri. */
  unmappedLabels: string[];
};

export type ImportOptions = {
  parserId?: string;
  /** Bu tarihten ONCEKI satirlar alinmaz (YYYY-MM-DD). */
  fromDate?: string;
};

/**
 * PDF'i okur, ayristirir ve TASLAK satirlari yazar. Bu asamada hicbir islem
 * kaydi olusmaz; kullanici onaylayana kadar hesap bakiyesi degismez.
 */
export async function importStatement(
  userId: number,
  accountId: number,
  filename: string,
  buffer: Buffer,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  const existing = findImportByHash(userId, fileHash);
  if (existing) {
    throw conflict(
      `Bu ekstre daha once yuklenmis ("${existing.filename}"). Ayni dosya iki kez islenemez.`,
      { importId: existing.id, status: existing.status },
    );
  }

  const extracted = await extractPdfText(buffer);

  const parser =
    (options.parserId ? findParserById(options.parserId) : null) ??
    detectParser(extracted.text, filename);

  const parsed = parser.parse(extracted.text);

  // Bakiye zinciri TUM satirlar uzerinde denetlenir. Tarih kesmesinden once
  // yapilmasi sart: kesilmis bir listede zincir dogal olarak kopuk gorunurdu.
  const chain = checkBalanceChain(parsed);
  // Kopukluk satirin KENDISINE baglanir; tarih kesmesi sonrasi diziyi yeniden
  // indekslemek gerekmesin diye referansla tutulur.
  const brokenLines = new Set(chain.gaps.map((gap) => parsed[gap.index]));

  // Ekstrenin "guncel" bakiyesi: zincirin bas tarafindaki satir.
  const newestLine = chain.order === 'asc' ? parsed[parsed.length - 1] : parsed[0];
  const statementBalanceKurus = newestLine?.balanceKurus ?? null;

  const lines = options.fromDate
    ? parsed.filter((line) => line.date >= options.fromDate!)
    : parsed;
  const skippedByDateCount = parsed.length - lines.length;

  const labelMap = listLabelMap(userId, parser.id);
  const unmappedLabels = new Set<string>();

  const db = getDb();
  db.exec('BEGIN');
  try {
    const importId = createImport(userId, {
      accountId,
      filename,
      fileHash,
      parserId: parser.id,
      extraction: extracted.method,
      pageCount: extracted.pageCount,
    });

    let duplicateCount = 0;

    // Ayni icerigin bu BELGEDEKI kacinci tekrari oldugunu tutar.
    const occurrences = new Map<string, number>();
    // Sistemdeki mevcut adet icerik anahtari basina BIR KEZ sorgulanir.
    const existingCounts = new Map<string, number>();

    for (const [index, line] of lines.entries()) {
      const key = contentKeyOf(accountId, line);
      const keyString = contentKeyString(key);

      const occurrence = occurrences.get(keyString) ?? 0;
      occurrences.set(keyString, occurrence + 1);

      let existingCount = existingCounts.get(keyString);
      if (existingCount === undefined) {
        existingCount = countContentMatches(userId, key, normalizeDescription);
        existingCounts.set(keyString, existingCount);
      }

      // Belgenin KENDI ICINDEKI tekrarlar mukerrer DEGILDIR: ayni gun ayni
      // tutarda ayni islemi iki kez yapmak olagandir. Yalnizca sistemde zaten
      // o kadar kopya varsa mukerrerdir.
      const isDuplicate = occurrence < existingCount;
      if (isDuplicate) duplicateCount++;

      let categoryId: number | null = null;
      if (line.label !== null) {
        const mapped = labelMap.get(foldTurkish(line.label));
        if (mapped === undefined) unmappedLabels.add(line.label);
        else categoryId = mapped;
      }

      insertDraftLine(userId, {
        importId,
        lineNo: index + 1,
        date: line.date,
        description: line.description,
        amountKurus: line.amountKurus,
        type: line.type,
        categoryId,
        label: line.label,
        balanceKurus: line.balanceKurus,
        chainBreak: brokenLines.has(line),
        externalHash: externalHash(userId, key, occurrence),
        isDuplicate,
        raw: line.raw,
      });
    }

    setBalanceCheck(userId, importId, {
      status: chain.status,
      gapCount: chain.gaps.length,
      gapKurus: chain.totalGapKurus,
      checkedPairs: chain.checkedPairs,
      uncheckedPairs: chain.uncheckedPairs,
    });

    db.exec('COMMIT');

    return {
      importId,
      parserId: parser.id,
      parserName: parser.name,
      extraction: extracted.method,
      pageCount: extracted.pageCount,
      lineCount: lines.length,
      skippedByDateCount,
      duplicateCount,
      balanceCheck: chain.status,
      balanceGapCount: chain.gaps.length,
      balanceGapKurus: chain.totalGapKurus,
      balanceCheckedPairs: chain.checkedPairs,
      balanceUncheckedPairs: chain.uncheckedPairs,
      statementBalanceKurus,
      unmappedLabels: [...unmappedLabels],
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Duzenlenmis bir taslak satiri icin parmak izini yeniden uretir.
 *
 * Icerik degistigi icin "kacinci tekrar" bilgisi de degisir: ayni ice
 * aktarimda, ayni icerikte ve DAHA KUCUK line_no'ya sahip satirlar sayilir.
 * Bu yapilmazsa duzenlenen satir, mevcut bir satirla ayni parmak izini alip
 * UNIQUE indekse takilabilirdi.
 */
export function recomputeLineHash(
  userId: number,
  accountId: number,
  lines: { id: number; line_no: number; date: string; description: string; amount_kurus: number; type: 'income' | 'expense' }[],
  editedId: number,
  edited: { date: string; description: string; amountKurus: number; type: 'income' | 'expense' },
): string {
  const key: ContentKey = {
    accountId,
    date: edited.date,
    amountKurus: edited.amountKurus,
    type: edited.type,
    normalizedDescription: normalizeDescription(edited.description),
  };
  const keyString = contentKeyString(key);
  const editedLineNo = lines.find((line) => line.id === editedId)?.line_no ?? 0;

  const occurrence = lines.filter((line) => {
    if (line.id === editedId || line.line_no >= editedLineNo) return false;
    return (
      contentKeyString({
        accountId,
        date: line.date,
        amountKurus: line.amount_kurus,
        type: line.type,
        normalizedDescription: normalizeDescription(line.description),
      }) === keyString
    );
  }).length;

  return externalHash(userId, key, occurrence);
}

export type ApplyResult = {
  created: number;
  skipped: number;
};

/**
 * Taslagi hesaba isler. Haric tutulan satirlar atlanir.
 *
 * Mukerrer kontrolu ice aktarim anindakiyle AYNI mantiktir (icerik + sira):
 * boylece belge icindeki mesru tekrarlar korunur, sistemde zaten olanlar
 * yazilmaz.
 */
export function applyImport(userId: number, importId: number, accountId: number): ApplyResult {
  const lines = listDraftLines(userId, importId);

  const db = getDb();
  db.exec('BEGIN');
  try {
    let created = 0;
    let skipped = 0;

    const occurrences = new Map<string, number>();
    const existingCounts = new Map<string, number>();

    for (const line of lines) {
      const key: ContentKey = {
        accountId,
        date: line.date,
        amountKurus: line.amount_kurus,
        type: line.type,
        normalizedDescription: normalizeDescription(line.description),
      };
      const keyString = contentKeyString(key);

      if (line.excluded === 1) {
        skipped++;
        continue;
      }

      const occurrence = occurrences.get(keyString) ?? 0;

      let existingCount = existingCounts.get(keyString);
      if (existingCount === undefined) {
        existingCount = countContentMatches(userId, key, normalizeDescription);
        existingCounts.set(keyString, existingCount);
      }

      // Sistemde bu icerikten zaten yeterince varsa yazma.
      if (occurrence < existingCount) {
        skipped++;
        occurrences.set(keyString, occurrence + 1);
        continue;
      }

      insertTransaction(userId, {
        accountId,
        categoryId: line.category_id,
        type: line.type,
        amountKurus: line.amount_kurus,
        date: line.date,
        description: line.description,
        source: 'ocr',
        sourceRefId: importId,
        externalHash: line.external_hash,
      });
      created++;
      occurrences.set(keyString, occurrence + 1);
    }

    setImportStatus(userId, importId, 'applied');
    db.exec('COMMIT');

    return { created, skipped };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
