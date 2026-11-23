import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatKurus,
  formatTRY,
  formatYearMonth,
  parseKurus,
  todayIso,
} from './format.ts';

describe('formatKurus', () => {
  it('binlik ayraci ve virgullu kurus uretir', () => {
    expect(formatKurus(123456)).toBe('1.234,56');
  });

  it('sifir ve kucuk degerleri iki haneli kurusla yazar', () => {
    expect(formatKurus(0)).toBe('0,00');
    expect(formatKurus(5)).toBe('0,05');
    expect(formatKurus(100)).toBe('1,00');
  });

  it('negatif tutarlarda eksi isaretini basa koyar', () => {
    expect(formatKurus(-123456)).toBe('-1.234,56');
    expect(formatKurus(-5)).toBe('-0,05');
  });

  it('buyuk sayilari dogru gruplar', () => {
    expect(formatKurus(123456789012)).toBe('1.234.567.890,12');
  });

  it('kesirli kurusu keser', () => {
    expect(formatKurus(1999.9)).toBe('19,99');
  });
});

describe('formatTRY', () => {
  it('sonuna bosluk ve TL simgesi ekler', () => {
    expect(formatTRY(123456)).toBe('1.234,56 ₺');
    expect(formatTRY(0)).toBe('0,00 ₺');
    expect(formatTRY(-100)).toBe('-1,00 ₺');
  });
});

describe('parseKurus', () => {
  it('tam sayiyi liraya cevirir', () => {
    expect(parseKurus('12')).toBe(1200);
  });

  it('virgullu ondaligi okur', () => {
    expect(parseKurus('12,5')).toBe(1250);
    expect(parseKurus('1.234,56')).toBe(123456);
  });

  it('noktali ondaligi okur', () => {
    expect(parseKurus('1234.56')).toBe(123456);
    expect(parseKurus('12.5')).toBe(1250);
  });

  it('"1.234" binlik ayraci sayilir', () => {
    expect(parseKurus('1.234')).toBe(123400);
  });

  it('virgulden sonra uc hane binlik ayraci sayilir (mevcut davranis)', () => {
    expect(parseKurus('1,002')).toBe(100200);
  });

  it('Ingilizce bicim: virgul binlik, nokta ondalik', () => {
    expect(parseKurus('1,234.56')).toBe(123456);
  });

  it('bosluk, TL ve ₺ ifadelerini yok sayar', () => {
    expect(parseKurus('  1.234,56  ')).toBe(123456);
    expect(parseKurus('1 234,56')).toBe(123456);
    expect(parseKurus('12 ₺')).toBe(1200);
    expect(parseKurus('12 TL')).toBe(1200);
  });

  it('float yuvarlama hatasi uretmez', () => {
    expect(parseKurus('0,29')).toBe(29);
    expect(parseKurus('0,07')).toBe(7);
    expect(parseKurus('1,1')).toBe(110);
    expect(parseKurus('19,99')).toBe(1999);
  });

  it('uc haneli ondaligi (1,005) binlik sayar; 4+ haneyi yuvarlar (mevcut davranis)', () => {
    expect(parseKurus('1,005')).toBe(100500);
    expect(parseKurus('1.005')).toBe(100500);
    expect(parseKurus('1,0049')).toBe(100);
  });

  it('negatif girdiyi destekler', () => {
    expect(parseKurus('-12,5')).toBe(-1250);
  });

  it('bos girdide hata firlatir', () => {
    expect(() => parseKurus('')).toThrow('Tutar bos olamaz');
    expect(() => parseKurus('   ')).toThrow('Tutar bos olamaz');
    expect(() => parseKurus('₺')).toThrow('Tutar bos olamaz');
  });

  it('gecersiz girdide hata firlatir', () => {
    expect(() => parseKurus('abc')).toThrow('Gecersiz tutar');
    expect(() => parseKurus('12abc')).toThrow('Gecersiz tutar');
    expect(() => parseKurus('1,2,3,x')).toThrow('Gecersiz tutar');
  });

  it('formatKurus ile gidis-donus tutarlidir', () => {
    for (const k of [0, 1, 99, 100, 123456, 99999999]) {
      expect(parseKurus(formatKurus(k))).toBe(k);
    }
  });
});

describe('formatDate', () => {
  it('ISO tarihi gg.aa.yyyy yapar', () => {
    expect(formatDate('2026-07-22')).toBe('22.07.2026');
  });

  it('zaman damgasi gelse de yalnizca tarih kismini kullanir (gun kaymaz)', () => {
    expect(formatDate('2026-07-22T23:59:59.000Z')).toBe('22.07.2026');
    expect(formatDate('2026-01-01T00:00:00Z')).toBe('01.01.2026');
  });

  it('bos girdide bos string doner', () => {
    expect(formatDate('')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('Europe/Istanbul saatiyle gg.aa.yyyy ss:dd yazar', () => {
    // 11:30Z = 14:30 Istanbul (UTC+3)
    expect(formatDateTime('2026-07-22T11:30:00Z').replace(/\s/g, ' ')).toBe('22.07.2026 14:30');
  });

  it('bos girdide bos string doner', () => {
    expect(formatDateTime('')).toBe('');
  });
});

describe('todayIso', () => {
  it('YYYY-MM-DD biciminde doner', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatYearMonth', () => {
  it('ay adini Turkce yazar', () => {
    expect(formatYearMonth('2026-07')).toBe('Temmuz 2026');
    expect(formatYearMonth('2026-01')).toBe('Ocak 2026');
    expect(formatYearMonth('2026-12')).toBe('Aralık 2026');
  });
});
