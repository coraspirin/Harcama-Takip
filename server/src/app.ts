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
  app.use('/api/dashboard', dashboardRouter);

  options.configure?.(app);

  app.use('/api', apiNotFoundHandler);

  // --- Build edilmis frontend (yalnizca production) ---
  if (env.isProd && fs.existsSync(env.CLIENT_DIR)) {
    app.use(express.static(env.CLIENT_DIR, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(env.CLIENT_DIR, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
