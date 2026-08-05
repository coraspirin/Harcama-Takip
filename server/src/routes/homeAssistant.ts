import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { sensitiveLimiter } from '../middleware/rateLimit.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import {
  deleteHaSettings,
  findHaSettings,
  recordHaResult,
  saveHaSettings,
} from '../db/haSettings.ts';
import { decryptSecret, encryptSecret, maskSecret } from '../services/cryptoService.ts';
import { sendNotification, testConnection } from '../services/haNotificationService.ts';

export const homeAssistantRouter: Router = Router();

homeAssistantRouter.use(requireUser);

/**
 * Ayarlar okunurken token ASLA geri donmez; yalnizca maskeli bir ozeti
 * gosterilir. Kullanici degistirmek isterse yenisini girer.
 */
homeAssistantRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const settings = findHaSettings(user.id);

    if (!settings) {
      res.json({ settings: null });
      return;
    }

    let tokenPreview: string;
    try {
      tokenPreview = maskSecret(decryptSecret(settings.token_encrypted));
    } catch {
      tokenPreview = '(cozulemedi - yeniden girin)';
    }

    res.json({
      settings: {
        baseUrl: settings.base_url,
        tokenPreview,
        notifyTarget: settings.notify_target,
        enabled: settings.enabled === 1,
        lastError: settings.last_error,
        lastSuccessAt: settings.last_success_at,
      },
    });
  }),
);

const saveSchema = z.object({
  baseUrl: z.string().trim().min(1, 'Home Assistant adresi gerekli').max(300),
  /** Bos birakilirsa mevcut token korunur (kullanici yalnizca hedefi degistiriyor olabilir). */
  token: z.string().trim().max(1000).optional(),
  notifyTarget: z.string().trim().max(200).nullable().default(null),
  enabled: z.boolean().default(false),
});

homeAssistantRouter.put(
  '/',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = saveSchema.parse(req.body);

    const existing = findHaSettings(user.id);

    let tokenEncrypted: string;
    if (input.token && input.token.length > 0) {
      tokenEncrypted = encryptSecret(input.token);
    } else if (existing) {
      tokenEncrypted = existing.token_encrypted;
    } else {
      throw badRequest('Ilk kayitta erisim token\'i zorunlu');
    }

    if (input.enabled && !input.notifyTarget) {
      throw badRequest('Bildirim gondermek icin bir hedef cihaz secmelisiniz');
    }

    saveHaSettings(user.id, {
      baseUrl: input.baseUrl,
      tokenEncrypted,
      notifyTarget: input.notifyTarget,
      enabled: input.enabled,
    });

    res.json({ saved: true });
  }),
);

const testSchema = z.object({
  baseUrl: z.string().trim().min(1).max(300),
  token: z.string().trim().max(1000).optional(),
  /** Verilirse test bildirimi de gonderilir. */
  notifyTarget: z.string().trim().max(200).optional(),
});

/**
 * Baglantiyi dogrular ve notify hedeflerini doner. Hedef verilirse gercek bir
 * test bildirimi gonderir - "kaydettim ama calisiyor mu?" belirsizligini
 * ortadan kaldirir.
 */
homeAssistantRouter.post(
  '/test',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = testSchema.parse(req.body);

    const existing = findHaSettings(user.id);

    let token: string;
    if (input.token && input.token.length > 0) {
      token = input.token;
    } else if (existing) {
      token = decryptSecret(existing.token_encrypted);
    } else {
      throw badRequest('Erisim token\'i gerekli');
    }

    const targets = await testConnection(input.baseUrl, token);

    let sent = false;
    if (input.notifyTarget) {
      await sendNotification(
        input.baseUrl,
        token,
        input.notifyTarget,
        'Harcama Takip',
        'Test bildirimi: baglanti calisiyor.',
      );
      sent = true;
      if (existing) recordHaResult(user.id, null);
    }

    res.json({ targets, testNotificationSent: sent });
  }),
);

homeAssistantRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (!deleteHaSettings(user.id)) throw notFound('Home Assistant ayari bulunamadi');
    res.json({ deleted: true });
  }),
);
