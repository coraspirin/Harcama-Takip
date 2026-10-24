import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env.ts';
import { apiNotFoundHandler, errorHandler } from './middleware/error.ts';
import { healthRouter } from './routes/health.ts';
import { setupRouter } from './routes/setup.ts';
import { authRouter } from './routes/auth.ts';
import { categoriesRouter } from './routes/categories.ts';
import { transactionsRouter } from './routes/transactions.ts';
import { budgetsRouter } from './routes/budgets.ts';
import { dataRouter } from './routes/data.ts';
import { reportsRouter } from './routes/reports.ts';
import { occurrencesRouter, scheduledRouter } from './routes/scheduled.ts';
import { notificationsRouter } from './routes/notifications.ts';
import { adminUsersRouter } from './routes/admin/users.ts';
import { adminAuditLogRouter } from './routes/admin/auditLog.ts';
import { matchingRouter } from './routes/matching.ts';
import { homeAssistantRouter } from './routes/homeAssistant.ts';
import { dashboardRouter } from './routes/dashboard.ts';
import { debtsRouter } from './routes/debts.ts';

export type CreateAppOptions = {
  /**
   * API route'lari kaydedildikten sonra calisir. Yalnizca testlerde, middleware
   * davranisini izole olcmek icin ek "probe" route'lari eklemekte kullanilir;
   * uretim yolunda cagrilmaz.
   */
  configure?: (app: express.Express) => void;
};

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  // Rate limit ve loglamanin dogru IP'yi gormesi icin (reverse proxy arkasinda)
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // COOKIE_SECURE, uygulamanin TLS arkasinda olup olmadiginin gostergesidir;
  // asagida iki HTTPS varsayimi buna baglanir.
  const behindTls = env.COOKIE_SECURE;

  app.use(
    helmet({
      // SPA ayni origin'den servis edildigi icin varsayilan CSP yeterli;
      // gelistirmede Vite'in inline script'lerini engellememesi icin kapali.
      contentSecurityPolicy: env.isProd && {
        useDefaults: true,
        directives: {
          // upgrade-insecure-requests helmet varsayilanlarinda VARDIR ve duz
          // HTTP ile yayinda felakettir: tarayici belgeyi http'den alir ama
          // TUM alt kaynaklari https'e yukseltir. TLS yoksa her script, css
          // ve ikon ERR_SSL_PROTOCOL_ERROR ile duser -- yani bos beyaz ekran.
          // Sunucu HTTP'de dinliyorsa direktifi kaldiriyoruz (null = sil).
          ...(behindTls ? {} : { 'upgrade-insecure-requests': null }),
        },
      },
      // HSTS'i de yalnizca gercekten HTTPS varken gonder. Duz HTTP uzerinde
      // tarayici zaten yok sayar; ayrica ileride ayni host HTTPS'e gecerse
      // yanlislikla bir yila kilitlemis olmayalim.
      hsts: behindTls,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(cookieParser());

  // --- API ---
  app.use('/api/health', healthRouter);
  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);

  // Normal kullanici veri uclari. Tumu requireUser ile korunur; super admin
  // bu route'larin hicbirine erisemez.
  app.use('/api/categories', categoriesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/data', dataRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/scheduled', scheduledRouter);
  app.use('/api/occurrences', occurrencesRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/debts', debtsRouter);
  app.use('/api/matching', matchingRouter);
  app.use('/api/settings/home-assistant', homeAssistantRouter);

  // Super admin uclari: yukaridaki veri route'larindan tamamen ayri bir grup.
  // requireSuperAdmin ile korunur ve hicbir finansal veriye dokunmaz.
  app.use('/api/admin/users', adminUsersRouter);
  app.use('/api/admin/audit-log', adminAuditLogRouter);

  options.configure?.(app);

  app.use('/api', apiNotFoundHandler);

  // --- Build edilmis frontend (yalnizca production) ---
  if (env.isProd && fs.existsSync(env.CLIENT_DIR)) {
    app.use(
      express.static(env.CLIENT_DIR, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          const name = path.basename(filePath);
          // Service worker ve manifest ONBELLEGE ALINMAMALI: onbellekten
          // servis edilen eski bir sw.js, guncellemeyi kalici olarak bloke
          // eder ve kullanicilar surekli eski surumde kalir.
          if (name === 'sw.js' || name === 'manifest.webmanifest' || name.startsWith('workbox-')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      }),
    );

    app.get('*', (_req, res) => {
      // index.html de onbelleklenmemeli; yeni hash'li varlik adlarini
      // yalnizca taze bir index.html duyurur.
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(env.CLIENT_DIR, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
