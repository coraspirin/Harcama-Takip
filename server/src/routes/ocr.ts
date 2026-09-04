import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { env } from '../config/env.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { idParamSchema, isoDateSchema, positiveKurusSchema } from '../lib/validation.ts';
import { accountExists, findAccount } from '../db/accounts.ts';
import { categoryExists } from '../db/categories.ts';
import {
  bulkUpdateDraftLines,
  deleteImport,
  findDraftLine,
  findImport,
  listDraftLines,
  listImports,
  updateDraftLine,
  type OcrDraftLineRow,
  type OcrImportWithCounts,
} from '../db/ocr.ts';
import { listLabelMapRows, upsertLabelMap } from '../db/labelMap.ts';
import { countTransactionsByImport, deleteTransactionsByImport } from '../db/transactions.ts';
import { getDb } from '../db/connection.ts';
import { applyImport, importStatement, recomputeLineHash } from '../services/ocr/ocrService.ts';
import { listParsers } from '../services/ocr/parserRegistry.ts';

export const ocrRouter: Router = Router();

ocrRouter.use(requireUser);

/** 15 MB: cok sayfali bir ekstre icin fazlasiyla yeterli. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const upload = multer({
  // Bellekte tutulur: dosya yalnizca ayristirma suresince gerekli, diske
  // yazip sonra silmek gereksiz bir kalici veri riski olusturur.
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Yalnizca PDF dosyasi yuklenebilir'));
      return;
    }
    cb(null, true);
  },
});

/**
 * OCR, auth'tan cok daha agir bir DoS vektorudur: tek bir taranmis PDF
 * saniyelerce CPU yer. Bu yuzden AYRI ve dar bir limit uygulanir.
 */
const ocrLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Cok fazla ekstre yuklediniz. Lutfen biraz bekleyin.',
      },
    });
  },
});

function serializeImport(row: OcrImportWithCounts) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    filename: row.filename,
    parserId: row.parser_id,
    extraction: row.extraction,
    pageCount: row.page_count,
    status: row.status,
    lineCount: row.line_count,
    excludedCount: row.excluded_count,
    balanceCheck: row.balance_check,
    balanceGapCount: row.balance_gap_count,
    balanceGapKurus: row.balance_gap_kurus,
    balanceCheckedPairs: row.balance_checked_pairs,
    balanceUncheckedPairs: row.balance_unchecked_pairs,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

function serializeLine(row: OcrDraftLineRow) {
  return {
    id: row.id,
    lineNo: row.line_no,
    date: row.date,
    description: row.description,
    amountKurus: row.amount_kurus,
    type: row.type,
    categoryId: row.category_id,
    label: row.label,
    balanceKurus: row.balance_kurus,
    chainBreak: row.chain_break === 1,
    excluded: row.excluded === 1,
    raw: row.raw,
  };
}

ocrRouter.get(
  '/parsers',
  asyncHandler(async (_req, res) => {
    res.json({ parsers: listParsers() });
  }),
);

ocrRouter.get(
  '/imports',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({ imports: listImports(user.id).map(serializeImport) });
  }),
);

ocrRouter.get(
  '/imports/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const found = findImport(user.id, id);
    if (!found) throw notFound('Ice aktarim bulunamadi');

    res.json({
      import: serializeImport(found),
      lines: listDraftLines(user.id, id).map(serializeLine),
    });
  }),
);

/**
 * PDF yukleme. Bu asamada hicbir islem kaydi olusmaz: sonuc bir TASLAKtir,
 * kullanici onaylayana kadar hesap bakiyesi degismez.
 */
ocrRouter.post(
  '/upload',
  ocrLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);

    if (!req.file) throw badRequest('PDF dosyasi gonderilmedi');

    const accountId = idParamSchema.parse(req.body?.accountId);
    if (!accountExists(user.id, accountId)) throw notFound('Secilen hesap bulunamadi');

    const parserId = typeof req.body?.parserId === 'string' ? req.body.parserId : undefined;

    // Tarih kesmesi: 2 yillik bir ekstrenin tamami istenmeyebilir (eski donem
    // elle girilmis olabilir). Ayristirma sonrasi, taslak yazilmadan uygulanir.
    const fromDate =
      typeof req.body?.fromDate === 'string' && req.body.fromDate !== ''
        ? isoDateSchema.parse(req.body.fromDate)
        : undefined;

    const result = await importStatement(user.id, accountId, req.file.originalname, req.file.buffer, {
      parserId,
      fromDate,
    });

    res.status(201).json({ result });
  }),
);

const lineSchema = z.object({
  date: isoDateSchema,
  description: z.string().trim().min(1).max(200),
  amountKurus: positiveKurusSchema,
  type: z.enum(['income', 'expense']),
  categoryId: z.number().int().positive().nullable().default(null),
  excluded: z.boolean().default(false),
});

ocrRouter.patch(
  '/lines/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = lineSchema.parse(req.body);

    const line = findDraftLine(user.id, id);
    if (!line) throw notFound('Satir bulunamadi');

    const parent = findImport(user.id, line.import_id);
    if (!parent) throw notFound('Ice aktarim bulunamadi');
    if (parent.status !== 'draft') throw badRequest('Islenmis ice aktarim duzenlenemez');

    if (input.categoryId !== null && !categoryExists(user.id, input.categoryId)) {
      throw notFound('Secilen kategori bulunamadi');
    }

    // Tutar/tarih/aciklama degistiyse parmak izi de degisir
    updateDraftLine(user.id, id, {
      ...input,
      externalHash: recomputeLineHash(
        user.id,
        line.import_id,
        parent.account_id,
        listDraftLines(user.id, line.import_id),
        id,
        input,
      ),
    });

    const updated = findDraftLine(user.id, id);
    res.json({ line: updated ? serializeLine(updated) : null });
  }),
);

const bulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(2000),
  action: z.enum(['exclude', 'include', 'setCategory']),
  categoryId: z.number().int().positive().nullable().default(null),
});

/** Secili satirlara toplu islem: 600 satiri tek tek duzenlemek pratik degil. */
ocrRouter.post(
  '/imports/:id/bulk',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = bulkSchema.parse(req.body);

    const found = findImport(user.id, id);
    if (!found) throw notFound('Ice aktarim bulunamadi');
    if (found.status !== 'draft') throw badRequest('Islenmis ice aktarim duzenlenemez');

    if (input.action === 'setCategory' && input.categoryId !== null) {
      if (!categoryExists(user.id, input.categoryId)) throw notFound('Secilen kategori bulunamadi');
    }

    const updated =
      input.action === 'setCategory'
        ? bulkUpdateDraftLines(user.id, id, input.ids, {
            action: 'setCategory',
            categoryId: input.categoryId,
          })
        : bulkUpdateDraftLines(user.id, id, input.ids, { action: input.action });

    res.json({ updated });
  }),
);

/** Banka etiketi -> kategori eslemeleri. Bir kez eslenir, hep hatirlanir. */
ocrRouter.get(
  '/label-map',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({
      mappings: listLabelMapRows(user.id).map((row) => ({
        parserId: row.parser_id,
        label: row.label,
        categoryId: row.category_id,
      })),
    });
  }),
);

const labelMapSchema = z.object({
  parserId: z.string().trim().min(1).max(50),
  label: z.string().trim().min(1).max(100),
  categoryId: z.number().int().positive().nullable(),
});

ocrRouter.put(
  '/label-map',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = labelMapSchema.parse(req.body);

    if (input.categoryId !== null && !categoryExists(user.id, input.categoryId)) {
      throw notFound('Secilen kategori bulunamadi');
    }

    upsertLabelMap(user.id, input.parserId, input.label, input.categoryId);
    res.json({ saved: true });
  }),
);

ocrRouter.post(
  '/imports/:id/apply',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const found = findImport(user.id, id);
    if (!found) throw notFound('Ice aktarim bulunamadi');
    if (found.status !== 'draft') throw badRequest('Bu ice aktarim zaten islenmis');

    const account = findAccount(user.id, found.account_id);
    if (!account) throw notFound('Hesap bulunamadi');

    res.json({ result: applyImport(user.id, id, found.account_id) });
  }),
);

/**
 * Ice aktarimi ve OLUSTURDUGU ISLEMLERI siler.
 *
 * Onceden islenmis bir ice aktarim yalnizca 'discarded' isaretleniyor, olusan
 * islemler yerinde kaliyordu; kullanici "kaldir" dedigi halde veri duruyordu.
 * Mukerrer bastirma da kaldirildigi icin yanlis aktarilmis bir ekstreyi geri
 * almanin tek yolu budur.
 */
ocrRouter.delete(
  '/imports/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const found = findImport(user.id, id);
    if (!found) throw notFound('Ice aktarim bulunamadi');

    const db = getDb();
    db.exec('BEGIN');
    try {
      const removedTransactions = deleteTransactionsByImport(user.id, id);
      deleteImport(user.id, id);
      db.exec('COMMIT');

      res.json({ deleted: true, removedTransactions });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }),
);

/** Silmeden once kullaniciya kac islemin gidecegini gosterebilmek icin. */
ocrRouter.get(
  '/imports/:id/impact',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const found = findImport(user.id, id);
    if (!found) throw notFound('Ice aktarim bulunamadi');

    res.json({ transactionCount: countTransactionsByImport(user.id, id) });
  }),
);
