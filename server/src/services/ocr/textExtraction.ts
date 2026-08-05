import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { env } from '../../config/env.ts';
import { AppError } from '../../lib/errors.ts';

const require = createRequire(import.meta.url);

const execFileAsync = promisify(execFile);

export type ExtractionResult = {
  text: string;
  /** 'text': PDF'in metin katmani okundu · 'ocr': goruntuye cevrilip tarandi */
  method: 'text' | 'ocr';
  pageCount: number;
};

/**
 * Metin katmani "kullanilabilir" sayilma esigi.
 *
 * Deger BILINCLI olarak dusuk: taranmis PDF'lerde pdfjs tipik olarak HIC
 * karakter (veya bir avuc bozuk glif) dondurur, gercek metin katmani olan
 * bir ekstrede ise en kisa haliyle bile onlarca karakter bulunur. Esigi
 * yuksek tutmak, kisa ama gecerli bir ekstreyi gereksiz yere OCR'a
 * dusururdu - hem yavas hem daha hatali.
 */
const MIN_USEFUL_CHARS = 20;

export type TextFragment = { x: number; y: number; width: number; text: string };

/**
 * Ayni satira ait parcalarin y farki icin tolerans (pt). Bir tablo satirinda
 * farkli punto/stildeki hucreler (kalin tutar, kucuk kurus) birkac ondalik pt
 * kayabilir.
 */
const ROW_TOLERANCE = 2.5;

/**
 * Iki parca arasinda BOSLUK sayilmasi icin gereken en kucuk yatay bosluk (pt).
 *
 * Sifirdan buyuk olmasi sart: pdfjs bir sayiyi cogu zaman birden fazla parcaya
 * boler (Garanti ekstresinde tutarin kurus kismi kucuk puntoyla ayri bir parca
 * olarak gelir). Parcalar arasina kosulsuz bosluk konursa "-820," + "00 TL"
 * birlesip "-820, 00 TL" olur ve para deseni (virgulden hemen sonra iki hane)
 * ARTIK ESLESMEZ -- ekstredeki tutarlarin tamami sessizce kaybolur.
 */
const SPACE_GAP = 1;

/**
 * pdfjs parcalarini gorsel satirlara toplar.
 *
 * y'yi yuvarlayarak kova olusturmak yerine KUMELEME yapar: yuvarlama, ayni
 * satirdaki iki hucre kova sinirinin iki yanina dustugunde (or. 500,9 ve 501,2)
 * satiri ikiye bolerdi.
 */
export function assembleRows(fragments: TextFragment[]): string[] {
  // PDF'te y yukaridan asagi azalir
  const sorted = [...fragments].sort((a, b) => b.y - a.y);
  const rows: TextFragment[][] = [];

  for (const fragment of sorted) {
    const current = rows[rows.length - 1];
    if (current && Math.abs(current[0]!.y - fragment.y) <= ROW_TOLERANCE) {
      current.push(fragment);
    } else {
      rows.push([fragment]);
    }
  }

  return rows.map((parts) => {
    const ordered = [...parts].sort((a, b) => a.x - b.x);
    let line = '';

    for (let i = 0; i < ordered.length; i++) {
      const part = ordered[i]!;
      if (i > 0) {
        const previous = ordered[i - 1]!;
        const gap = part.x - (previous.x + previous.width);
        if (gap > SPACE_GAP) line += ' ';
      }
      line += part.text;
    }

    return line;
  });
}

/**
 * PDF'ten metin cikarir.
 *
 * ONCE metin katmani denenir (pdfjs-dist): bankalarin urettigi PDF'lerin
 * cogunda metin zaten gomulu oldugu icin bu yol hem 10 kat hizli hem de
 * hatasizdir. Yalnizca taranmis/goruntu PDF'lerde OCR'a dusulur.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractionResult> {
  const layer = await extractTextLayer(buffer);

  if (layer.text.replace(/\s/g, '').length >= MIN_USEFUL_CHARS) {
    return { ...layer, method: 'text' };
  }

  const ocr = await extractWithOcr(buffer, layer.pageCount);
  return ocr;
}

async function extractTextLayer(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  // pdfjs saf ESM ve agir; yalnizca gerektiginde yuklenir.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // pdfjs gomulu olmayan standart fontlar icin bu yolu ister; verilmezse
  // her belgede uyari basar.
  const standardFontDataUrl = path.join(
    path.dirname(require.resolve('pdfjs-dist/package.json')),
    'standard_fonts/',
  );

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    // Sunucu tarafinda sistem fontu ve eval gerekmez
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;

  const pages: string[] = [];

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();

    const fragments: TextFragment[] = [];

    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const transform = item.transform as number[];
      fragments.push({
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
        width: typeof item.width === 'number' ? item.width : 0,
        text: item.str,
      });
    }

    pages.push(assembleRows(fragments).join('\n'));
    page.cleanup();
  }

  const pageCount = doc.numPages;
  await doc.destroy();

  return { text: pages.join('\n'), pageCount };
}

/**
 * Taranmis PDF yolu: pdftoppm ile sayfalari PNG'ye cevirip tesseract.js
 * (Turkce) ile okur.
 *
 * pdftoppm poppler-utils paketinden gelir ve Docker imajina kuruludur.
 * Yerel gelistirmede yoksa acik bir hata mesaji doner - sessizce bos
 * sonuc donmek, kullaniciya "ekstrede hic islem yok" gibi yanlis bir
 * izlenim verirdi.
 */
async function extractWithOcr(buffer: Buffer, pageCount: number): Promise<ExtractionResult> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harcama-ocr-'));
  const pdfPath = path.join(workDir, 'input.pdf');

  try {
    await fs.writeFile(pdfPath, buffer);

    try {
      // 200 dpi: OCR dogrulugu ile hiz arasinda makul denge
      await execFileAsync('pdftoppm', ['-r', '200', '-png', pdfPath, path.join(workDir, 'page')], {
        timeout: 120_000,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT') {
        // Sunucu yapilandirmasi eksik: 500 yerine acik bir 503 doneriz ki
        // kullanici "ekstrede islem yok" gibi yanlis bir sonuc cikarmasin.
        throw new AppError(
          503,
          'OCR_UNAVAILABLE',
          'Bu PDF taranmis (metin katmani yok) ve goruntuye cevirmek icin gereken "pdftoppm" ' +
            'sunucuda bulunamadi. Docker ile calistirdiginizda bu arac imajda hazir gelir.',
        );
      }
      throw err;
    }

    const files = (await fs.readdir(workDir)).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) throw new Error('PDF goruntuye cevrilemedi');

    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('tur', undefined, {
      langPath: env.TESSDATA_DIR,
      // Model imajda gomulu; calisma aninda agdan indirme beklenmez.
      cachePath: env.TESSDATA_DIR,
    });

    try {
      const pages: string[] = [];
      for (const file of files) {
        const { data } = await worker.recognize(path.join(workDir, file));
        pages.push(data.text);
      }
      return { text: pages.join('\n'), method: 'ocr', pageCount: files.length || pageCount };
    } finally {
      await worker.terminate();
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
