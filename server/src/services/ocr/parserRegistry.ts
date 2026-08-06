import {
  foldTurkish,
  parseStatementText,
  type ParsedLine,
  type ParserOptions,
} from './statementParser.ts';

export type BankParser = {
  id: string;
  name: string;
  /**
   * Dosya adindan ve/veya icerikten banka tespiti. Ilk eslesen parser secilir;
   * hicbiri eslesmezse "generic" kullanilir.
   */
  matches: (text: string, filename: string) => boolean;
  parse: (text: string) => ParsedLine[];
};

function includesAny(haystack: string, needles: string[]): boolean {
  // Banka adlari da aksan-duyarsiz eslesir: "İş Bankası" ~ "IS BANKASI"
  const folded = foldTurkish(haystack);
  return needles.some((needle) => folded.includes(foldTurkish(needle)));
}

/**
 * Yeni banka eklemek: asagidaki diziye bir kayit eklemek yeterli.
 * Cogu banka icin fark yalnizca isaret/sutun kurallarindadir, bu yuzden ortak
 * satir ayristiricisi (statementParser) secenekle beslenir.
 *
 * NOT: Bu kurallar yaygin ekstre bicimlerine gore yazildi. Gercek PDF'lerle
 * karsilasildiginda ince ayar gerekebilir; her satir arayuzde duzenlenebilir
 * oldugu icin hatali bir tahmin veri kaybina yol acmaz.
 */
function bankParser(
  id: string,
  name: string,
  keywords: string[],
  options: Partial<ParserOptions> = {},
): BankParser {
  return {
    id,
    name,
    matches: (text, filename) => includesAny(`${filename} ${text.slice(0, 4000)}`, keywords),
    parse: (text) => parseStatementText(text, options),
  };
}

/** Kredi karti ekstresi: tutarlar isaretsiz yazilir ve harcamayi ifade eder. */
const CREDIT_CARD_OPTIONS: Partial<ParserOptions> = {
  unsignedMeansExpense: true,
  lastAmountIsBalance: false,
};

/**
 * Garanti BBVA hesap hareketlerindeki "Etiket" sutununun degerleri.
 *
 * Banka her satiri zaten siniflandiriyor; bu sozluk sayesinde etiket
 * aciklamadan ayrilip kategori tahminine cevrilir. Sozlukte olmayan bir ifade
 * ASLA kirpilmaz, bu yuzden liste eksik olsa bile zarar vermez.
 */
const GARANTI_LABELS = [
  'Telekomünikasyon',
  'Kurum Ödemesi',
  'Para Transferi',
  'Kart Ödemesi',
  'Kira Ödemesi',
  'Faiz / Komisyon',
  'Taksitli Avans Hesap',
  'Nakit Avans',
  'Para Çekme',
  'Para Yatırma',
  'Sigorta',
  'Vergi',
  'Kredi',
  'Maaş',
  'Diğer',
];

export const PARSERS: BankParser[] = [
  bankParser('isbank', 'Türkiye İş Bankası', ['is bankasi', 'işbank', 'isbank', 'iş bankası']),
  bankParser('garanti', 'Garanti BBVA', ['garanti', 'bbva'], { labels: GARANTI_LABELS }),
  bankParser('yapikredi', 'Yapı Kredi', ['yapi kredi', 'yapı kredi', 'yapikredi', 'worldcard']),
  bankParser('akbank', 'Akbank', ['akbank', 'axess']),
  bankParser('ziraat', 'Ziraat Bankası', ['ziraat', 'bankkart']),
  bankParser('enpara', 'Enpara', ['enpara', 'qnb']),

  // Kredi karti ekstreleri: isaretsiz tutar = harcama
  bankParser(
    'kredi-karti',
    'Kredi kartı ekstresi (genel)',
    ['ekstre', 'kredi kart', 'donem borcu', 'dönem borcu', 'asgari odeme', 'asgari ödeme'],
    CREDIT_CARD_OPTIONS,
  ),
];

export const GENERIC_PARSER: BankParser = {
  id: 'generic',
  name: 'Genel (banka tespit edilemedi)',
  matches: () => true,
  parse: (text) => parseStatementText(text),
};

export function detectParser(text: string, filename: string): BankParser {
  return PARSERS.find((parser) => parser.matches(text, filename)) ?? GENERIC_PARSER;
}

export function findParserById(id: string): BankParser | null {
  if (id === GENERIC_PARSER.id) return GENERIC_PARSER;
  return PARSERS.find((parser) => parser.id === id) ?? null;
}

export function listParsers(): { id: string; name: string }[] {
  return [...PARSERS, GENERIC_PARSER].map(({ id, name }) => ({ id, name }));
}
