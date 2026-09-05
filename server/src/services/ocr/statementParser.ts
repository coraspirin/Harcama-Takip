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

export type RejectedLine = {
  reason: RejectReason;
  raw: string;
  /**
   * Bu satir KAYIP BIR ISLEM olabilir mi?
   *
   * Ayristirilamayan her satiri esit sesle bildirmek, denetimi degersiz
   * kilar: bir kredi karti ekstresinin 30 satiri baslik, bonus ozeti ve
   * ucret tablosudur ve "30 satir okunamadi" uyarisi bir dahaki sefere
   * gercek kayip cikinca da gormezden gelinir. Siniflandirma ölçülebilir
   * uc olcute dayanir; bkz. classifySuspects.
   */
  suspect: boolean;
};

export type ParseResult = {
  lines: ParsedLine[];
  /**
   * Okunamadigi icin ATILAN, ama kayit gorunumundeki satirlar.
   *
   * Ayristirici eskiden cozemedigi satiri sessizce atiyordu. Garanti
   * ekstrelerinde bakiye zinciri 47 kopukluk bildirdiginde hangi satirlarin
   * kaybolduguna dair elde HICBIR kanit yoktu; sebep ancak canli veritabani
   * kazilarak daraltilabildi. Atilanlar artik sebebiyle birlikte saklanir.
   *
   * Kayip bir islem olma ihtimali olanlar "suspect" ile isaretlidir.
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
const NUMERIC_DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;

/**
 * Ay ADIYLA yazilmis tarih: "26 Temmuz 2026".
 *
 * Garanti kredi karti ekstresi tarihleri boyle yaziyor. Yalnizca sayisal
 * bicim taninirken bu belgelerden TEK BIR SATIR bile okunamiyordu: her satir
 * "tarih yok" diye eleniyor, sonuc bos bir taslak oluyordu.
 *
 * Eslesme foldTurkish'ten gecmis metin uzerinde yapilir; boylece hem buyuk/
 * kucuk harf hem de OCR'da kaybolan aksanlar ("Agustos" ~ "Ağustos") ayni
 * sayilir. foldTurkish uzunlugu degistirmedigi icin bulunan konum ozgun
 * satirda da gecerlidir.
 */
const TURKISH_MONTHS: Record<string, number> = {
  ocak: 1,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  eylul: 9,
  ekim: 10,
  kasim: 11,
  aralik: 12,
};

const TEXT_DATE_RE = new RegExp(
  String.raw`(\d{1,2})\s+(` + Object.keys(TURKISH_MONTHS).join('|') + String.raw`)\s+(\d{4})`,
);

export type FoundDate = {
  index: number;
  length: number;
  /** Gecerli degilse null: "tarih yok" ile "tarih bozuk" ayri seylerdir. */
  iso: string | null;
};

/**
 * Satirdaki ILK tarihi bulur; sayisal ve yazili bicimin ikisini de tanir.
 *
 * Bir satirda her ikisi birden gecebilir (or. aciklamasinda "03/04/2026
 * tarihli" yazan bir kayit). Kaydin tarihi daima ONCE gelendir.
 */
function findDate(line: string): FoundDate | null {
  const numeric = NUMERIC_DATE_RE.exec(line);
  const text = TEXT_DATE_RE.exec(foldTurkish(line));

  const candidates: FoundDate[] = [];
  if (numeric) {
    candidates.push({
      index: numeric.index,
      length: numeric[0].length,
      iso: normalizeDate(numeric[1]!, numeric[2]!, numeric[3]!),
    });
  }
  if (text) {
    candidates.push({
      index: text.index,
      length: text[0].length,
      iso: normalizeDate(text[1]!, String(TURKISH_MONTHS[text[2]!]), text[3]!),
    });
  }

  candidates.sort((a, b) => a.index - b.index);
  return candidates[0] ?? null;
}

function hasDate(line: string): boolean {
  return findDate(line) !== null;
}

function startsWithDate(line: string): boolean {
  return findDate(line)?.index === 0;
}

function countDates(line: string): number {
  const numeric = (line.match(new RegExp(NUMERIC_DATE_RE.source, 'g')) ?? []).length;
  const text = (foldTurkish(line).match(new RegExp(TEXT_DATE_RE.source, 'g')) ?? []).length;
  return numeric + text;
}

/**
 * 1.234,56 · 1234,56 · -1.234,56 · +1.234,56 · 1.234,56- · 1.234,56+
 *
 * ARTI isareti de desene DAHIL: Garanti gelirleri "+400,00 TL" diye yaziyor.
 * Desen yalnizca "400,00" kismini yakalasaydi, aciklama tutarin baslangicina
 * kadar kesilir ve sonunda sarkan bir "+" kalirdi; bu da etiket sozlugu
 * eslesmesini ("... Para Transferi") sessizce bozardi.
 *
 * SONDAKI arti da yakalanir. Garanti kredi karti ekstresi alacaklari boyle
 * yaziyor ("19,36+" iade, "45.762,00+" odeme); yalnizca sondaki eksi
 * taninirken bu satirlar isaretsiz gorunuyor ve kredi karti kuralina takilip
 * HARCAMA sayiliyordu.
 */
const MONEY_RE = /[-+]?\d{1,3}(?:\.\d{3})*,\d{2}[-+]?|[-+]?\d+,\d{2}[-+]?/g;

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

/** Tutari olan ama tarihi olmayan satir: sarilmis bir kaydin GOVDESI. */
function isLooseBody(line: string): boolean {
  return HAS_MONEY_RE.test(line) && !hasDate(line);
}

function mergeWrappedRows(lines: string[]): string[] {
  const merged: string[] = [];
  let i = 0;
  /** Bir onceki GIRDI satiri sahipsiz kaldi ve govde gorunumunde mi? */
  let previousIsLooseBody = false;

  while (i < lines.length) {
    const line = lines[i]!;
    const isHead = startsWithDate(line) && !HAS_MONEY_RE.test(line);

    /*
     * Tarihle BASLAYAN ama tutari olmayan satir, sarilmis bir kaydin basidir.
     *
     * ONCEKI satir sahipsiz bir govdeyse bu bas ONA aittir, ileriye degil.
     * Ters dizilmis kayitlar ARKA ARKAYA geldiginde
     *
     *     govde1 | bas1 | govde2 | bas2 | govde3 | bas3
     *
     * ileri yonlu birlestirme bas1'i govde2'ye, bas2'yi govde3'e bagliyordu:
     * tarihler bir kayit KAYIYOR, dizinin iki ucunda govde1 ile bas3 sahipsiz
     * kaliyor ve bir kayit tumuyle dusuyordu. Iki Garanti ekstresinde 47
     * kaydin 28'i tek basina duran ciftlerdi ve duzelmisti; kalan 5'i
     * (3 + 2) tam olarak bu ardisik dizilerdi.
     */
    if (!isHead || previousIsLooseBody) {
      merged.push(line);
      previousIsLooseBody = isLooseBody(line);
      i++;
      continue;
    }

    const parts = [line];
    let j = i + 1;
    let completed = false;

    while (j < lines.length && parts.length <= MAX_CONTINUATION) {
      const candidate = lines[j]!;

      // Yeni bir tarih goruldu: bu, sarma degil siradaki kayittir.
      if (hasDate(candidate)) break;

      parts.push(candidate);
      j++;

      if (HAS_MONEY_RE.test(candidate)) {
        completed = true;
        break;
      }
    }

    // Her iki durumda da son yazilan satir bir BAS satiridir (ya da onunla
    // baslayan birlesik kayit); govde degildir.
    previousIsLooseBody = false;

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

/**
 * TERS DIZILMIS sarma: govde ustte, tarih altta.
 *
 * Garanti ekstresinde aciklamasi iki satira tasan kayitlarin bir kismi soyle
 * cikiyor:
 *
 *   HÜSEYİN ZEKİ ERDOĞAN-... tarafindan +400,00 TL 400,00 TL
 *   03.08.2026 Para Transferi
 *
 * Ileri yonlu birlestirme bu sirayi goremez ve iki parca da tek basina
 * gecersizdir (ustte tarih yok, altta tutar yok), dolayisiyla KAYIT TUMUYLE
 * DUSER. Iki Garanti ekstresinde 47 kaydin kaybolma sebebi buydu; hatanin
 * varligini bakiye zinciri kanitlamisti (kopukluklarin toplami, hesabin
 * bakiye hatasiyla kurusuna kadar ayni), sebebini ise okunamayan satirlarin
 * kaydi gosterdi.
 *
 * Ayni belgede iki bicim BIR ARADA bulunuyor. Bu yuzden ters birlestirme
 * ileri yonlu gecisten ARTAKALAN satirlar uzerinde calisir: bir tarih satiri
 * ileriye baglanabiliyorsa oncelik daima ileri yondedir ve buraya hic gelmez.
 */
function mergeInvertedWraps(lines: string[], minBodyTokens: number): string[] {
  const merged: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const body = lines[i]!;
    const head = lines[i + 1];

    if (head !== undefined && isInvertedPair(body, head, minBodyTokens)) {
      merged.push(joinInvertedWrap(head, body));
      i += 2;
      continue;
    }

    merged.push(body);
    i++;
  }

  return merged;
}

function isInvertedPair(body: string, head: string, minBodyTokens: number): boolean {
  // Govde tarihsiz olmali ve tablonun SAG UCUNU (tutar + bakiye) tasimali.
  // Tek parasal degeri olan bir baslik satiri ("Kullanilabilir Bakiye :
  // 27.326,74 TL") bu esikte elenir; yoksa uydurma bir kayda donusurdu.
  if (hasDate(body)) return false;
  if ((body.match(MONEY_RE) ?? []).length < minBodyTokens) return false;

  // Bas satiri tarihle BASLAMALI, tutar tasimamali ve TEK tarih icermeli.
  // "04/09/2024 - 04/09/2026 araliginda 144'ten fazla kayit bulunmustur."
  // gibi donem basliklari iki tarih tasidigi icin disarida kalir.
  if (!startsWithDate(head)) return false;
  if (HAS_MONEY_RE.test(head)) return false;
  return countDates(head) === 1;
}

/**
 * Ters cifti, ekstrenin kendi sutun sirasina geri koyar:
 * tarih | aciklama | etiket | tutar | bakiye
 *
 * Bas satirindan artan kisim (genelde etiket) tutarlarin HEMEN ONUNE eklenir.
 * Sona eklenseydi bakiyenin arkasinda kalir, splitLabel etiketi bulamaz ve
 * kayit kategorisiz kalirdi.
 */
function joinInvertedWrap(head: string, body: string): string {
  const found = findDate(head)!;
  const date = head.slice(0, found.length);
  const rest = head.slice(found.length).trim();

  const tokens = [...body.matchAll(MONEY_RE)];
  const cut = tokens[Math.max(0, tokens.length - 2)]?.index ?? body.length;

  return [date, body.slice(0, cut).trim(), rest, body.slice(cut).trim()]
    .filter((part) => part !== '')
    .join(' ');
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

/** "1.234,56-", "-1.234,56" ve "1.234,56+" bicimlerini isaretli kurusa cevirir. */
function toSignedKurus(token: string): number | null {
  const trailing = token.endsWith('-') || token.endsWith('+') ? token.slice(-1) : '';
  const cleaned = trailing === '' ? token : token.slice(0, -1);
  try {
    const value = parseKurus(cleaned);
    return trailing === '-' ? -value : value;
  } catch {
    return null;
  }
}

/**
 * Tutarin isareti ekstrede ACIKCA yazilmis mi?
 *
 * Kredi karti ekstresinde isaretsiz tutar harcamadir; ama "19,36+" gibi acikca
 * artili bir satir ALACAKTIR ve bu kurala girmemelidir. Isaretsizlik ile
 * "arti yazilmis" ayirt edilmezse iadeler harcama olarak kaydedilir.
 */
function hasExplicitSign(token: string): boolean {
  return /^[-+]/.test(token) || /[-+]$/.test(token);
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
  return hasDate(line) || HAS_MONEY_RE.test(line);
}

/** Ayni metin bu kadar tekrarliyorsa sayfa ustbilgisi/altbilgisidir. */
const REPEAT_NOISE = 3;

/**
 * Tutari olmayan bir satir bu uzunlugun ustundeyse duz yazidir.
 *
 * Kayip bir kaydin bas parcasi kisadir ("03.11.2025 Para Transferi", 25
 * karakter); ekstre dipnotlari yuzlerce karakterdir.
 */
const PROSE_LENGTH = 80;

type Rejection = { reason: RejectReason; raw: string; index: number };

/**
 * Okunamayan satirlarin hangilerinin GERCEKTEN kayip islem olabilecegini
 * belirler.
 *
 * Uc olcut, uc gercek belgeden cikarildi:
 *
 *  1. ISLEM BLOGUNUN DISI. Kayitlar belgede bitisik bir blok olusturur.
 *     Ilk kayittan once ya da son kayittan sonra kalan satirlar baslik ve
 *     dipnottur. Kredi karti ekstresindeki 30 satirin TAMAMI boyleydi;
 *     kaybolan Garanti satirlarinin tamami ise blogun ICINDEYDI.
 *  2. TEKRAR. Ayni metin defalarca geciyorsa sayfa ustbilgisi/altbilgisidir
 *     (Enpara'nin 9 sayfalik ekstresinde ayni dipnot 9 kez).
 *  3. TUTARSIZ UZUN METIN. Duz yazi paragraflari.
 *
 * Hicbir kayit okunamadiysa siniflandirma yapilmaz: boyle bir belgede her
 * satir suphelidir ve uyari en yuksek sesle verilmelidir.
 */
function classifySuspects(
  rejections: Rejection[],
  firstAccepted: number | null,
  lastAccepted: number | null,
): RejectedLine[] {
  const repeats = new Map<string, number>();
  for (const rejection of rejections) {
    repeats.set(rejection.raw, (repeats.get(rejection.raw) ?? 0) + 1);
  }

  return rejections.map(({ reason, raw, index }) => {
    let suspect = true;

    if (firstAccepted === null || lastAccepted === null) {
      suspect = true;
    } else if (index < firstAccepted || index > lastAccepted) {
      suspect = false;
    } else if ((repeats.get(raw) ?? 0) >= REPEAT_NOISE) {
      suspect = false;
    } else if (!HAS_MONEY_RE.test(raw) && raw.length > PROSE_LENGTH) {
      suspect = false;
    }

    return { reason, raw, suspect };
  });
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
  // Once ileri yonlu sarma (tarih ustte), sonra ARTAKALANLAR uzerinde ters
  // sarma (tarih altta). Sira onemli: ileri yon daima onceliklidir.
  const lines = mergeInvertedWraps(
    mergeWrappedRows(normalized),
    opts.lastAmountIsBalance ? 2 : 1,
  );
  const result: ParsedLine[] = [];
  const rejections: Rejection[] = [];

  // Kayitlarin belgedeki ilk ve son konumu; okunamayan satirlarin islem
  // blogunun ICINDE mi DISINDA mi kaldigini belirlemek icin.
  let firstAccepted: number | null = null;
  let lastAccepted: number | null = null;
  let index = -1;

  const reject = (reason: RejectReason, raw: string) => {
    if (looksLikeRecord(raw)) rejections.push({ reason, raw, index });
  };

  for (const line of lines) {
    index++;
    if (shouldSkip(line)) {
      reject('baslik', line);
      continue;
    }

    const found = findDate(line);
    if (found === null) {
      reject('tarih-yok', line);
      continue;
    }
    if (found.iso === null) {
      reject('gecersiz-tarih', line);
      continue;
    }
    const date = found.iso;

    // Tutarlar tarihten SONRAKI kisimda aranir: tarihin kendi rakamlari
    // parasal deger sanilmasin.
    const afterDate = line.slice(found.index + found.length);
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
     * Bakiye sutunu YOKSA (kredi karti ekstresi) tutar en sagdaki jetondur.
     * Gercek bir Garanti kredi karti ekstresinde dogrulandi: satirlarda
     * tutardan ONCE "Kalan Borc / Taksit" (3.720,91x3=11.162,73) ve "Bonus"
     * (44,80) sutunlari var. Soldan sayan eski kural bu satirlarda bonus
     * puanini ya da taksit anaparasini tutar sanip yaziyordu; sagdan
     * sayildiginda ekstrenin kendi "Donem Harcamalari" toplamiyla kurusuna
     * kadar tutuyor.
     */
    const amountToken = hasBalanceColumn
      ? tokens[tokens.length - 2]!
      : tokens[tokens.length - 1]!;

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
    } else if (hasExplicitSign(amountToken[0])) {
      // Ekstre tutari ACIKCA artili yazmis ("19,36+"): bu bir alacaktir ve
      // kredi kartinin "isaretsiz = harcama" kuralina girmez.
      type = 'income';
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

    if (firstAccepted === null) firstAccepted = index;
    lastAccepted = index;
  }

  return {
    lines: result,
    rejected: classifySuspects(rejections, firstAccepted, lastAccepted),
  };
}
