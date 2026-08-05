import { parseKurus } from '../../lib/money.ts';
import { isIsoDate } from '../../lib/date.ts';

export type ParsedLine = {
  date: string; // YYYY-MM-DD
  description: string;
  amountKurus: number; // her zaman POZITIF; yon "type" ile verilir
  type: 'income' | 'expense';
  raw: string;
};

export type ParserOptions = {
  /**
   * Kredi karti ekstrelerinde tutarlar genelde ISARETSIZ yazilir ve harcamayi
   * ifade eder; hesap hareketlerinde ise eksi isareti cikisi gosterir.
   */
  unsignedMeansExpense: boolean;
  /**
   * Satirdaki son parasal deger genelde BAKIYE sutunudur. Iki veya daha fazla
   * tutar varsa sonuncusu atilir.
   */
  lastAmountIsBalance: boolean;
  /** Bu ifadeleri iceren satirlar gelir (iade/odeme) sayilir. */
  incomeKeywords: string[];
};

/**
 * Turkce'ye ozgu harfleri ASCII karsiliklarina indirger ve kucuk harfe cevirir.
 *
 * Iki sorunu birden cozer:
 *  1. toLocaleLowerCase('tr') "IADE" -> "ıade" yapar (noktasiz i), duz
 *     toLowerCase ise "İADE" -> "i̇ade" (birlesik nokta) uretir; ikisi de
 *     anahtar kelime eslemesini sessizce bozar.
 *  2. OCR ciktisinda diakritikler sikca kaybolur veya bozulur; "ödeme" ile
 *     "odeme" ayni sayilmalidir.
 */
export function foldTurkish(value: string): string {
  return value
    .replace(/[İIı]/g, 'i')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[Üü]/g, 'u')
    .replace(/[Öö]/g, 'o')
    .replace(/[Çç]/g, 'c')
    .toLowerCase();
}

export const DEFAULT_OPTIONS: ParserOptions = {
  unsignedMeansExpense: false,
  lastAmountIsBalance: true,
  // Anahtar kelimeler de foldTurkish'ten gecirilmis halde yazilir
  incomeKeywords: [
    'iade',
    'odeme',
    'virman gelen',
    'gelen havale',
    'gelen eft',
    'faiz geliri',
    'maas',
    'alacak',
  ],
};

/** gg.aa.yyyy · gg/aa/yyyy · gg-aa-yyyy · gg.aa.yy */
const DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;

/** 1.234,56 · 1234,56 · -1.234,56 · 1.234,56- (sonda eksi) */
const MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}-?|-?\d+,\d{2}-?/g;

/** MONEY_RE'nin durumsuz (global olmayan) esi; test() icin gerekli. */
const HAS_MONEY_RE = new RegExp(MONEY_RE.source);

/**
 * Aciklamasi iki satira tasan kayitlari tek satirda birlestirir.
 *
 * Ekstrelerde uzun aciklama sarildiginda tarih ilk satirda, tutar ise ikinci
 * satirda kalir. Satir satir bakildiginda ilk satirda tutar, ikinci satirda
 * tarih bulunmadigi icin kayit IKI KEZ elenir ve tamamen kaybolur. Ornek:
 *
 *   03.08.2026 abdullah mucahid erdogan-KENDIME -FAST-CEP
 *   SUBE-7125000222 Para Transferi -57.200,00 TL -249.146,27 TL
 */
function mergeWrappedRows(lines: string[]): string[] {
  const merged: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];

    const isOrphanHead = DATE_RE.test(line) && !HAS_MONEY_RE.test(line);
    const isOrphanTail =
      next !== undefined && !DATE_RE.test(next) && HAS_MONEY_RE.test(next);

    if (isOrphanHead && isOrphanTail) {
      merged.push(`${line} ${next}`);
      i++; // ikinci satir tuketildi
    } else {
      merged.push(line);
    }
  }

  return merged;
}

/** Ozet/baslik satirlarini eleyen ifadeler. */
const SKIP_PATTERNS = [
  /^\s*(tarih|islem tarihi|açıklama|aciklama|tutar|bakiye|toplam)\b/i,
  /devreden bakiye/i,
  /son ödeme tarihi|son odeme tarihi/i,
  /asgari ödeme|asgari odeme/i,
  /sayfa\s*\d+/i,
  /ekstre (dönemi|donemi)/i,
];

function normalizeDate(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  let y = Number(year);

  // Iki haneli yil: 00-79 -> 2000'ler, 80-99 -> 1900'ler
  if (year.length === 2) y = y < 80 ? 2000 + y : 1900 + y;

  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** "1.234,56-" ve "-1.234,56" bicimlerini isaretli kurusa cevirir. */
function toSignedKurus(token: string): number | null {
  const trailingMinus = token.endsWith('-');
  const cleaned = trailingMinus ? token.slice(0, -1) : token;
  try {
    const value = parseKurus(cleaned);
    return trailingMinus ? -value : value;
  } catch {
    return null;
  }
}

function shouldSkip(line: string): boolean {
  if (line.trim().length < 8) return true;
  return SKIP_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Turk bankalarinin ekstre/hesap hareketi metinlerini satir satir ayristirir.
 *
 * Bilincli olarak TOLERANSLI: cozulemeyen satirlar hata firlatmaz, sessizce
 * atlanir. Amac tam dogruluk degil, kullanicinin onaylayacagi bir TASLAK
 * uretmek; her satir arayuzde duzenlenebilir.
 */
export function parseStatementText(
  text: string,
  options: Partial<ParserOptions> = {},
): ParsedLine[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const normalized = text.split(/\r?\n/).map((raw) => raw.replace(/\s+/g, ' ').trim());
  const lines = mergeWrappedRows(normalized);
  const result: ParsedLine[] = [];

  for (const line of lines) {
    if (shouldSkip(line)) continue;

    const dateMatch = DATE_RE.exec(line);
    if (!dateMatch) continue;

    const date = normalizeDate(dateMatch[1]!, dateMatch[2]!, dateMatch[3]!);
    if (date === null) continue;

    // Tutarlar tarihten SONRAKI kisimda aranir: tarihin kendi rakamlari
    // parasal deger sanilmasin.
    const afterDate = line.slice(dateMatch.index + dateMatch[0].length);
    const tokens = afterDate.match(MONEY_RE) ?? [];
    if (tokens.length === 0) continue;

    const usable =
      opts.lastAmountIsBalance && tokens.length > 1 ? tokens.slice(0, -1) : tokens;

    const signed = toSignedKurus(usable[0]!);
    if (signed === null || signed === 0) continue;

    // Aciklama: tarih ile ilk tutar arasindaki metin
    const firstTokenIndex = afterDate.indexOf(usable[0]!);
    const description =
      afterDate
        .slice(0, firstTokenIndex)
        .replace(/[|;]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Aciklama yok';

    const folded = foldTurkish(line);
    const looksLikeIncome = opts.incomeKeywords.some((keyword) =>
      folded.includes(foldTurkish(keyword)),
    );

    let type: 'income' | 'expense';
    if (signed < 0) {
      type = 'expense';
    } else if (opts.unsignedMeansExpense) {
      // Kredi karti ekstresi: isaretsiz tutar harcamadir, iade/odeme haric
      type = looksLikeIncome ? 'income' : 'expense';
    } else {
      type = 'income';
    }

    result.push({
      date,
      description: description.slice(0, 200),
      amountKurus: Math.abs(signed),
      type,
      raw: line,
    });
  }

  return result;
}
