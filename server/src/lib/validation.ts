import { z } from 'zod';

/**
 * Kullanici adi karakter kumesi bilincli olarak dar tutulmustur: Turkce
 * buyuk/kucuk harf donusumunun (I/i, İ/ı) yarattigi eslesme sorunlarini
 * bastan engeller.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Kullanici adi en az 3 karakter olmali')
  .max(32, 'Kullanici adi en fazla 32 karakter olabilir')
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    'Kullanici adi yalnizca harf, rakam, nokta, alt tire ve tire icerebilir',
  );

export const passwordSchema = z
  .string()
  .min(8, 'Sifre en az 8 karakter olmali')
  .max(128, 'Sifre en fazla 128 karakter olabilir');

export const emailSchema = z
  .string()
  .trim()
  .email('Gecerli bir e-posta adresi girin')
  .max(254)
  .optional()
  .or(z.literal('').transform(() => undefined));

/** Yol parametrelerindeki sayisal id'ler. */
export const idParamSchema = z.coerce.number().int().positive();

/** Kurus cinsinden tutar: her zaman tam sayi. */
export const kurusSchema = z
  .number()
  .int('Tutar kurus cinsinden tam sayi olmali')
  .min(-1_000_000_000_00)
  .max(1_000_000_000_00);

export const positiveKurusSchema = kurusSchema.refine((v) => v > 0, 'Tutar sifirdan buyuk olmali');

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-MM-DD biciminde olmali');

export const yearMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Donem YYYY-MM biciminde olmali');
