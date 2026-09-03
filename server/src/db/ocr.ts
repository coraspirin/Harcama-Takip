import { getDb } from './connection.ts';

export type OcrImportRow = {
  id: number;
  user_id: number;
  account_id: number;
  filename: string;
  file_hash: string;
  parser_id: string;
  extraction: 'text' | 'ocr';
  page_count: number;
  status: 'draft' | 'applied' | 'discarded';
  balance_check: 'ok' | 'gaps' | 'unavailable' | null;
  balance_gap_count: number;
  balance_gap_kurus: number;
  balance_checked_pairs: number;
  balance_unchecked_pairs: number;
  created_at: string;
  applied_at: string | null;
};

export type OcrImportWithCounts = OcrImportRow & {
  account_name: string;
  line_count: number;
  duplicate_count: number;
  excluded_count: number;
};

export type OcrDraftLineRow = {
  id: number;
  user_id: number;
  import_id: number;
  line_no: number;
  date: string;
  description: string;
  amount_kurus: number;
  type: 'income' | 'expense';
  category_id: number | null;
  label: string | null;
  balance_kurus: number | null;
  chain_break: number;
  external_hash: string;
  is_duplicate: number;
  excluded: number;
  raw: string | null;
};

const SELECT_IMPORT = `
  SELECT i.*,
         a.name AS account_name,
         COALESCE((SELECT COUNT(*) FROM ocr_draft_lines l
                   WHERE l.import_id = i.id AND l.user_id = i.user_id), 0) AS line_count,
         COALESCE((SELECT COUNT(*) FROM ocr_draft_lines l
                   WHERE l.import_id = i.id AND l.user_id = i.user_id
                     AND l.is_duplicate = 1), 0) AS duplicate_count,
         COALESCE((SELECT COUNT(*) FROM ocr_draft_lines l
                   WHERE l.import_id = i.id AND l.user_id = i.user_id
                     AND l.excluded = 1), 0) AS excluded_count
  FROM ocr_imports i
  JOIN accounts a ON a.id = i.account_id AND a.user_id = i.user_id
`;

export function findImportByHash(userId: number, fileHash: string): OcrImportRow | null {
  const row = getDb()
    .prepare('SELECT * FROM ocr_imports WHERE user_id = ? AND file_hash = ?')
    .get(userId, fileHash) as OcrImportRow | undefined;
  return row ?? null;
}

export function listImports(userId: number): OcrImportWithCounts[] {
  return getDb()
    .prepare(`${SELECT_IMPORT} WHERE i.user_id = ? ORDER BY i.created_at DESC, i.id DESC LIMIT 50`)
    .all(userId) as OcrImportWithCounts[];
}

export function findImport(userId: number, id: number): OcrImportWithCounts | null {
  const row = getDb()
    .prepare(`${SELECT_IMPORT} WHERE i.user_id = ? AND i.id = ?`)
    .get(userId, id) as OcrImportWithCounts | undefined;
  return row ?? null;
}

export type CreateImportInput = {
  accountId: number;
  filename: string;
  fileHash: string;
  parserId: string;
  extraction: 'text' | 'ocr';
  pageCount: number;
};

export function createImport(userId: number, input: CreateImportInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO ocr_imports
         (user_id, account_id, filename, file_hash, parser_id, extraction, page_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.accountId,
      input.filename,
      input.fileHash,
      input.parserId,
      input.extraction,
      input.pageCount,
    );
  return Number(result.lastInsertRowid);
}

export function setImportStatus(
  userId: number,
  id: number,
  status: 'draft' | 'applied' | 'discarded',
): void {
  getDb()
    .prepare(
      `UPDATE ocr_imports
       SET status = ?, applied_at = CASE WHEN ? = 'applied' THEN datetime('now') ELSE applied_at END
       WHERE user_id = ? AND id = ?`,
    )
    .run(status, status, userId, id);
}

export function deleteImport(userId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM ocr_imports WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return Number(result.changes) > 0;
}

export type CreateDraftLineInput = {
  importId: number;
  lineNo: number;
  date: string;
  description: string;
  amountKurus: number;
  type: 'income' | 'expense';
  categoryId: number | null;
  label: string | null;
  balanceKurus: number | null;
  chainBreak: boolean;
  externalHash: string;
  isDuplicate: boolean;
  raw: string;
};

export function insertDraftLine(userId: number, input: CreateDraftLineInput): void {
  getDb()
    .prepare(
      `INSERT INTO ocr_draft_lines
         (user_id, import_id, line_no, date, description, amount_kurus, type,
          category_id, label, balance_kurus, chain_break,
          external_hash, is_duplicate, excluded, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.importId,
      input.lineNo,
      input.date,
      input.description,
      input.amountKurus,
      input.type,
      input.categoryId,
      input.label,
      input.balanceKurus,
      input.chainBreak ? 1 : 0,
      input.externalHash,
      input.isDuplicate ? 1 : 0,
      // Mukerrer satirlar varsayilan olarak HARIC baslar; kullanici isterse acar.
      input.isDuplicate ? 1 : 0,
      input.raw,
    );
}

export type BalanceCheckInput = {
  status: 'ok' | 'gaps' | 'unavailable';
  gapCount: number;
  gapKurus: number;
  checkedPairs: number;
  uncheckedPairs: number;
};

export function setBalanceCheck(userId: number, importId: number, input: BalanceCheckInput): void {
  getDb()
    .prepare(
      `UPDATE ocr_imports
       SET balance_check = ?, balance_gap_count = ?, balance_gap_kurus = ?,
           balance_checked_pairs = ?, balance_unchecked_pairs = ?
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      input.status,
      input.gapCount,
      input.gapKurus,
      input.checkedPairs,
      input.uncheckedPairs,
      userId,
      importId,
    );
}

export type BulkLineAction =
  | { action: 'exclude' }
  | { action: 'include' }
  | { action: 'setCategory'; categoryId: number | null };

/**
 * Secili satirlara toplu islem. 600 satirlik bir taslakta tek tek PATCH
 * atmak pratikte kullanilamaz.
 *
 * Satirlar hem kullaniciya hem ice aktarima gore filtrelenir: baskasinin
 * satiri veya baska bir ice aktarimin satiri id listesine sizsa bile
 * guncellenmez.
 */
export function bulkUpdateDraftLines(
  userId: number,
  importId: number,
  ids: number[],
  input: BulkLineAction,
): number {
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(', ');
  const db = getDb();

  if (input.action === 'setCategory') {
    const result = db
      .prepare(
        `UPDATE ocr_draft_lines SET category_id = ?
         WHERE user_id = ? AND import_id = ? AND id IN (${placeholders})`,
      )
      .run(input.categoryId, userId, importId, ...ids);
    return Number(result.changes);
  }

  const result = db
    .prepare(
      `UPDATE ocr_draft_lines SET excluded = ?
       WHERE user_id = ? AND import_id = ? AND id IN (${placeholders})`,
    )
    .run(input.action === 'exclude' ? 1 : 0, userId, importId, ...ids);
  return Number(result.changes);
}

export function listDraftLines(userId: number, importId: number): OcrDraftLineRow[] {
  return getDb()
    .prepare('SELECT * FROM ocr_draft_lines WHERE user_id = ? AND import_id = ? ORDER BY line_no')
    .all(userId, importId) as OcrDraftLineRow[];
}

export function findDraftLine(userId: number, id: number): OcrDraftLineRow | null {
  const row = getDb()
    .prepare('SELECT * FROM ocr_draft_lines WHERE user_id = ? AND id = ?')
    .get(userId, id) as OcrDraftLineRow | undefined;
  return row ?? null;
}

export type UpdateDraftLineInput = {
  date: string;
  description: string;
  amountKurus: number;
  type: 'income' | 'expense';
  categoryId: number | null;
  excluded: boolean;
  externalHash: string;
};

export function updateDraftLine(userId: number, id: number, input: UpdateDraftLineInput): void {
  getDb()
    .prepare(
      `UPDATE ocr_draft_lines
       SET date = ?, description = ?, amount_kurus = ?, type = ?, category_id = ?,
           excluded = ?, external_hash = ?
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      input.date,
      input.description,
      input.amountKurus,
      input.type,
      input.categoryId,
      input.excluded ? 1 : 0,
      input.externalHash,
      userId,
      id,
    );
}

/** Bu parmak izine sahip bir islem zaten var mi? */
export function transactionExistsWithHash(userId: number, externalHash: string): boolean {
  const row = getDb()
    .prepare('SELECT id FROM transactions WHERE user_id = ? AND external_hash = ?')
    .get(userId, externalHash) as { id: number } | undefined;
  return row !== undefined;
}
