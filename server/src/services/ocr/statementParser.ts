import { parseKurus } from '../../lib/money.ts';
import { isIsoDate } from '../../lib/date.ts';

export type ParsedLine = {
  date: string; // YYYY-MM-DD
  description: string;
  amountKurus: number; // her zaman POZITIF; yon "type" ile verilir
  type: 'income' | 'expense';
  /**
   * Bankanin kendi siniflandirmasi ("Telekomunikasyon", "Kira Odemesi"...).
   * Kategori tahmini icin kullanilir; ekstrede yoksa null.
   */
  label: string | null;
  /**
   * Satirdan SONRAKI hesap bakiyesi, isaretli kurus. Ardisik satirlar
   * arasindaki fark okunan tutarlari dogrulamaya yarar (bkz. balanceChain).
   * Ekstrede bakiye sutunu yoksa null.
   */
  balanceKurus: number | null;
  raw: string;
};

/** Bir satirin neden okunamadigi. Arayuzde oldugu gibi gosterilir. */
export type RejectReason =
  | 'baslik'
  | 'tarih-yok'
  | 'gecersiz-tarih'
  | 'tutar-yok'
  | 'tutar-sifir';

export type RejectedLine = { reason: RejectReason; raw: string };

export type ParseResult = {
  lines: ParsedLine[];
  /**
   * Okunamadigi icin ATILAN, ama kayit gorunumundeki satirlar.
   *
   * Ayristirici eskiden cozemedigi satiri sessizce atiyordu. Garanti
   * ekstrelerinde bakiye zinciri 47 kopukluk bildirdiginde hangi satirlarin
   * kaybolduguna dair elde HICBIR kanit yoktu; sebep ancak canli veritabani
   * kazilarak daraltilabildi. Atilanlar artik sebebiyle birlikte saklanir.
   */
  rejected: RejectedLine[];
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
  /**
   * Bankanin kendi etiket sozlugu ("Telekomunikasyon", "Kira Odemesi"...).
   *
   * Aciklama bu degerlerden biriyle BITIYORSA ayrilir. Yalnizca TAM eslesme
   * kesildigi icin aciklamanin sonundan yanlislikla kelime kirpilmaz; sozluk
   * bos birakilirsa etiket cikarimi hic calismaz.
   */
  labels: string[];
  /**
   * Etiket sutununun aciklamaya gore konumu.
   *
   * Garanti etiketi aciklamanin SONUNA, Enpara ("Hareket tipi") BASINA yazar.
   * Yanlis uctan kirpmak etiketi bulamaz ve aciklamayi kirli birakir.
   */
  labelPosition: 'prefix' | 'suffix';
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
  labels: [],
  labelPosition: 'suffix',
};

/**
 * Aciklamaya bitisik gelen banka etiketini ayirir.
 *
 * Donen aciklama etiketten arindirilmis, etiket ise ekstredeki ozgun yazimiyla
 * verilir. Eslesme aksan/buyuk-kucuk harf duyarsizdir (foldTurkish).
 */
export function splitLabel(
  description: string,
  labels: string[],
  position: 'prefix' | 'suffix' = 'suffix',
): { description: string; label: string | null } {
  const folded = foldTurkish(description);

  // Uzun etiketler once denenir: "Gelen Transfer" ile "Transfer" ayni anda
  // sozlukteyse uzun olani dogru sonucu verir.
  const ordered = [...labels].sort((a, b) => b.length - a.length);

  for (const label of ordered) {
    const foldedLabel = foldTurkish(label);
    const hit = position === 'prefix'
      ? folded.startsWith(foldedLabel)
      : folded.endsWith(foldedLabel);
    if (!hit) continue;

    const cut = (position === 'prefix'
      ? description.slice(label.length)
      : description.slice(0, description.length - label.length)
    ).trim();

    // Aciklamanin TAMAMI etiketten ibaretse kirpmayiz: aciklamasiz bir satir,
    // etiketi aciklama olarak gostermekten daha az bilgilendirici olurdu.
    if (cut === '') return { description, label: null };

    return { description: cut, label };
  }

  return { description, label: null };
}

/** gg.aa.yyyy · gg/aa/yyyy · gg-aa-yyyy · gg.aa.yy */
const DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;

/**
 * 1.234,56 · 1234,56 · -1.234,56 · +1.234,56 · 1.234,56- (sonda eksi)
 *
 * ARTI isareti de desene DAHIL: Garanti gelirleri "+400,00 TL" diye yaziyor.
 * Desen yalnizca "400,00" kismini yakalasaydi, aciklama tutarin baslangicina
 * kadar kesilir ve sonunda sarkan bir "+" kalirdi; bu da etiket sozlugu
 * eslesmesini ("... Para Transferi") sessizce bozardi.
 */
const MONEY_RE = /[-+]?\d{1,3}(?:\.\d{3})*,\d{2}-?|[-+]?\d+,\d{2}-?/g;

/** MONEY_RE'nin durumsuz (global olmayan) esi; test() icin gerekli. */
const HAS_MONEY_RE = new RegExp(MONEY_RE.source);

/**
 * Bir kaydin sarilan satirlarini tek satirda birlestirir.
 *
 * Ekstrede uzun bir aciklama sutuna sigmadiginda kayit birden fazla goruntu
 * satirina boluner: tarih ilk satirda kalir, tutar en sondaki satira duser,
 * arada tutarsiz ve tarihsiz devam satirlari olur. Satir satir bakildiginda
 * bu parcalarin HICBIRI gecerli sayilmaz (ilkinde tutar yok, digerlerinde
 * tarih yok) ve kayit tamamen kaybolur.
 *
 * Onceki surum yalnizca IKI satirlik sarmayi birlestiriyordu; Enpara gibi
 * aciklama sutunu dar olan ekstrelerde uc satira tasan kayitlar sessizce
 * dusuyordu. Artik tutar bulunana kadar devam satirlari toplanir.
 *
 *   26.08.2026 Giden Transfer Ferhat Alec, Borc odeme,
 *   EFT (FAST) sorgu
 *   no: 4773565098 -50.000,00 TL -96.350,00 TL
 *
 * MAX_CONTINUATION siniri bilerek dar: sinir olmasaydi, tarih iceren ama
 * kayit olmayan bir baslik satiri (or. "01.08.2026 - 31.08.2026 donemi")
 * sayfanin tamamini yutup ilgisiz metni tek satira yapistirabilirdi.
 */
const MAX_CONTINUATION = 6;

/**
 * Birlestirmeyi yalnizca TARIHLE BASLAYAN satirlar baslatabilir.
 *
 * Ekstre basliklarinda ortasinda tarih gecen ama kayit olmayan satirlar var
 * ("Sayin ... 01/01/2026 - 03/09/2026 tarihleri arasindaki..."). Bunlarin
 * birlestirme baslatmasina izin verilseydi, devaminda gelen
 * "Bakiye : -222.673,26 TL" satirini yutup UYDURMA bir islem uretirlerdi.
 * Gercek kayit satirlari daima tarihle baslar.
 */
const STARTS_WITH_DATE_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/;

function mergeWrappedRows(lines: string[]): string[] {
  const merged: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Tarihle BASLAYAN ama tutari olmayan satir, sarilmis bir kaydin basidir.
    if (!STARTS_WITH_DATE_RE.test(line) || HAS_MONEY_RE.test(line)) {
      merged.push(line);
      i++;
      continue;
    }

    const parts = [line];
    let j = i + 1;
    let completed = false;

    while (j < lines.length && parts.length <= MAX_CONTINUATION) {
      const candidate = lines[j]!;

      // Yeni bir tarih goruldu: bu, sarma degil siradaki kayittir.
      if (DATE_RE.test(candidate)) break;

      parts.push(candidate);
      j++;

      if (HAS_MONEY_RE.test(candidate)) {
        completed = true;
        break;
      }
    }

    if (completed) {
      merged.push(parts.join(' '));
      i = j;
    } else {
      // Tutar bulunamadi: satirlari BIRLESTIRMEDEN birak. Alakasiz metni
      // yapistirmak, kaydi kaybetmekten daha zararlidir.
      merged.push(line);
      i++;
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
 * Atilan satirin RAPORLANMAYA deger olup olmadigi.
 *
 * Bir ekstrenin buyuk kismi baslik, sayfa numarasi ve sutun adidir; hepsini
 * "okunamadi" diye listelemek gercek kaybi gurultuye bogar. Kaybolan bir islem
 * satirinda ise daima ya tarih ya da parasal bir deger bulunur.
 */
function looksLikeRecord(line: string): boolean {
  return DATE_RE.test(line) || HAS_MONEY_RE.test(line);
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
): ParseResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const normalized = text.split(/\r?\n/).map((raw) => raw.replace(/\s+/g, ' ').trim());
  const lines = mergeWrappedRows(normalized);
  const result: ParsedLine[] = [];
  const rejected: RejectedLine[] = [];

  const reject = (reason: RejectReason, raw: string) => {
    if (looksLikeRecord(raw)) rejected.push({ reason, raw });
  };

  for (const line of lines) {
    if (shouldSkip(line)) {
      reject('baslik', line);
      continue;
    }

    const dateMatch = DATE_RE.exec(line);
    if (!dateMatch) {
      reject('tarih-yok', line);
      continue;
    }

    const date = normalizeDate(dateMatch[1]!, dateMatch[2]!, dateMatch[3]!);
    if (date === null) {
      reject('gecersiz-tarih', line);
      continue;
    }

    // Tutarlar tarihten SONRAKI kisimda aranir: tarihin kendi rakamlari
    // parasal deger sanilmasin.
    const afterDate = line.slice(dateMatch.index + dateMatch[0].length);
    // Jetonun KONUMU da gerekiyor: ayni sayi hem aciklamada hem tutar
    // sutununda gecebilir ve indexOf yanlis yeri bulur.
    const tokens = [...afterDate.matchAll(MONEY_RE)];
    if (tokens.length === 0) {
      reject('tutar-yok', line);
      continue;
    }

    const hasBalanceColumn = opts.lastAmountIsBalance && tokens.length > 1;

    // Son jeton bakiye sutunudur. Onceden okunup ATILIYORDU; artik saklaniyor
    // cunku ardisik satirlar arasindaki fark, okunan tutarlarin dogrulugunu
    // aritmetik olarak kanitlar (bkz. balanceChain.ts).
    const balanceKurus = hasBalanceColumn
      ? toSignedKurus(tokens[tokens.length - 1]![0])
      : null;

    /*
     * TUTAR, BAKIYENIN HEMEN SOLUNDAKI JETONDUR.
     *
     * Onceden "tarihten sonraki ILK parasal deger tutardir" varsayiliyordu.
     * Enpara aciklamanin ICINE de tutar yaziyor:
     *
     *   03.04.2026 Vergi Kesintisi 100.000,00 TL 12 ay vadeli ihtiyac
     *   kredinizin ... KKDF -50,85 TL 9.000,02 TL
     *
     * Ilk jeton kredinin anaparasi; gercek tutar -50,85. Eski kural bu satiri
     * "100.000,00 TL gelir" diye kaydediyor, tek bir ekstrede 47 satiri
     * bozuyordu. Tutar ile bakiye tablonun en sagdaki iki sutunudur;
     * aciklamada gecen tutarlar daima sollarinda kalir.
     *
     * Bakiye sutunu YOKSA (kredi karti ekstresi) eski davranis korunur: o
     * bicimlerde tutardan sonra baska sutunlar gelebiliyor ve sagdan saymanin
     * dogrulugu gercek bir ekstreyle sinanmis degil.
     */
    const amountToken = hasBalanceColumn ? tokens[tokens.length - 2]! : tokens[0]!;

    const signed = toSignedKurus(amountToken[0]);
    if (signed === null) {
      reject('tutar-yok', line);
      continue;
    }
    if (signed === 0) {
      reject('tutar-sifir', line);
      continue;
    }

    // Aciklama: tarih ile TUTAR SUTUNU arasindaki metin. Aciklamanin kendi
    // icindeki tutarlar (kredi anaparasi gibi) boylece aciklamada kalir.
    const rawDescription =
      afterDate
        .slice(0, amountToken.index ?? 0)
        .replace(/[|;]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Aciklama yok';

    // Banka etiketi aciklamanin sonuna yapisik gelir; ayrilir.
    const { description, label } = splitLabel(rawDescription, opts.labels, opts.labelPosition);

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
      label,
      balanceKurus,
      raw: line,
    });
  }

  return { lines: result, rejected };
}
