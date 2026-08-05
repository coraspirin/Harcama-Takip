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
import { banksRouter } from './routes/banks.ts';
import { accountsRouter } from './routes/accounts.ts';
import { categoriesRouter } from './routes/categories.ts';
import { transactionsRouter } from './routes/transactions.ts';
import { statementsRouter } from './routes/statements.ts';
import { budgetsRouter } from './routes/budgets.ts';
import { dataRouter } from './routes/data.ts';
import { reportsRouter } from './routes/reports.ts';
import { occurrencesRouter, scheduledRouter } from './routes/scheduled.ts';
import { notificationsRouter } from './routes/notifications.ts';
import { adminUsersRouter } from './routes/admin/users.ts';
import { adminAuditLogRouter } from './routes/admin/auditLog.ts';
import { ocrRouter } from './routes/ocr.ts';
import { dashboardRouter } from './routes/dashboard.ts';

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

  app.use(
    helmet({
      // SPA ayni origin'den servis edildigi icin varsayilan CSP yeterli;
      // gelistirmede Vite'in inline script'lerini engellememesi icin kapali.
      contentSecurityPolicy: env.isProd,
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
  app.use('/api/banks', banksRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/statements', statementsRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/data', dataRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/scheduled', scheduledRouter);
  app.use('/api/occurrences', occurrencesRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/ocr', ocrRouter);

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
