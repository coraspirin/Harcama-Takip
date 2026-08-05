import crypto from 'node:crypto';
import { getDb } from '../../db/connection.ts';
import { conflict } from '../../lib/errors.ts';
import {
  createImport,
  findImportByHash,
  insertDraftLine,
  listDraftLines,
  setImportStatus,
  transactionExistsWithHash,
} from '../../db/ocr.ts';
import { insertTransaction } from '../../db/transactions.ts';
import { detectParser, findParserById } from './parserRegistry.ts';
import { extractPdfText } from './textExtraction.ts';

/**
 * Bir islem satirinin PARMAK IZI. Ayni ekstre farkli bir dosya adiyla ikinci
 * kez yuklenirse veya donemleri ust uste binen iki ekstre gelirse ayni satir
 * iki kez islenmesin diye kullanilir.
 *
 * Aciklama normalize edilir (bosluk/buyuk-kucuk harf farki parmak izini
 * degistirmemeli), hesap dahil edilir (ayni tutar iki farkli kartta ayri
 * harcamadir).
 */
export function externalHash(
  userId: number,
  accountId: number,
  date: string,
  amountKurus: number,
  type: string,
  description: string,
): string {
  const normalized = description
    .toLocaleLowerCase('tr')
    .replace(/\s+/g, ' ')
    .trim();

  return crypto
    .createHash('sha256')
    .update(`${userId}|${accountId}|${date}|${amountKurus}|${type}|${normalized}`)
    .digest('hex');
}

export type ImportResult = {
  importId: number;
  parserId: string;
  parserName: string;
  extraction: 'text' | 'ocr';
  pageCount: number;
  lineCount: number;
  duplicateCount: number;
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
  forcedParserId?: string,
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
    (forcedParserId ? findParserById(forcedParserId) : null) ??
    detectParser(extracted.text, filename);

  const lines = parser.parse(extracted.text);

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
    // Ayni dosya icinde tekrar eden satirlar da mukerrer sayilir
    const seen = new Set<string>();

    lines.forEach((line, index) => {
      const hash = externalHash(
        userId,
        accountId,
        line.date,
        line.amountKurus,
        line.type,
        line.description,
      );

      const isDuplicate = seen.has(hash) || transactionExistsWithHash(userId, hash);
      if (isDuplicate) duplicateCount++;
      seen.add(hash);

      insertDraftLine(userId, {
        importId,
        lineNo: index + 1,
        date: line.date,
        description: line.description,
        amountKurus: line.amountKurus,
        type: line.type,
        externalHash: hash,
        isDuplicate,
        raw: line.raw,
      });
    });

    db.exec('COMMIT');

    return {
      importId,
      parserId: parser.id,
      parserName: parser.name,
      extraction: extracted.method,
      pageCount: extracted.pageCount,
      lineCount: lines.length,
      duplicateCount,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export type ApplyResult = {
  created: number;
  skipped: number;
};

/**
 * Taslagi hesaba isler. Haric tutulan satirlar atlanir; benzersiz
 * external_hash indeksi sayesinde ayni satir iki kez yazilamaz.
 */
export function applyImport(userId: number, importId: number, accountId: number): ApplyResult {
  const lines = listDraftLines(userId, importId);

  const db = getDb();
  db.exec('BEGIN');
  try {
    let created = 0;
    let skipped = 0;

    for (const line of lines) {
      if (line.excluded === 1) {
        skipped++;
        continue;
      }

      // Yarista veya elle eklenmis bir kayit varsa tekrar yazma
      if (transactionExistsWithHash(userId, line.external_hash)) {
        skipped++;
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
    }

    setImportStatus(userId, importId, 'applied');
    db.exec('COMMIT');

    return { created, skipped };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
