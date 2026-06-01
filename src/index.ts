import 'dotenv/config';
import express from 'express';

// Sin estos handlers, Node 15+ termina el proceso ante un unhandledRejection
// y queda al supervisor (PM2/ts-node-dev --respawn) volver a levantarlo. Mientras
// tanto, las requests en vuelo quedan colgadas y el frontend parece "congelado".
// Loggeamos y seguimos: cada error real ya fue manejado por la ruta o irá al
// errorHandler; lo que llega acá indica un bug que conviene logear sin matar el proceso.
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { verifyAdmin } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';

import authRouter from './routes/auth';
import categoriesRouter from './routes/categories';
import productsRouter from './routes/products';
import bannersRouter from './routes/banners';
import configRouter from './routes/config';
import checkoutRouter from './routes/checkout';
import webhookRouter from './routes/webhook';
import sitemapRouter from './routes/sitemap';

import adminProductsRouter from './routes/admin/products';
import adminCategoriesRouter from './routes/admin/categories';
import adminBannersRouter from './routes/admin/banners';
import adminStockRouter from './routes/admin/stock';
import adminOrdersRouter from './routes/admin/orders';
import adminConfigRouter from './routes/admin/config';

const app = express();

// Detrás de un reverse proxy en loopback (ngrok en dev, nginx en prod):
// necesario para que req.ip y express-rate-limit lean la IP real desde
// X-Forwarded-For. Sin esto, rate-limit lanza ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 'loopback');

// Las respuestas de la API son datos dinámicos (órdenes, stock, config).
// Sin esto, Express manda un ETag débil y el navegador revalida con 304,
// sirviendo body cacheado viejo (p. ej. lista de órdenes vacía).
app.set('etag', false);

app.use(helmet());

// CORS — rechaza peticiones de orígenes no permitidos.
// FRONTEND_URL acepta una lista separada por coma (p. ej. localhost + túnel ngrok).
const allowedOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Permitir requests sin origin (server-to-server, Postman en dev)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS not allowed'));
  },
  credentials: true,
}));

// Rate limiting
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intentá más tarde' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login' },
});

// Rate limit del webhook MP: protege contra abuso/DoS porque cada request
// dispara una llamada a la API de MP. MP reintenta hasta 5 veces, en operación
// normal no debería superar ~10/min.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// El webhook de MP necesita el body crudo para verificar la firma.
// limit pequeño porque los payloads de MP son chicos (<2kb).
app.use('/api/webhook', webhookLimiter, express.raw({ type: 'application/json', limit: '50kb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Nunca cachear respuestas de la API: son datos dinámicos y la caché
// del navegador hacía que el panel mostrara listas obsoletas.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Health check para monitoring (UptimeRobot, etc.)
app.get('/health', (_req, res) => { res.json({ ok: true, ts: Date.now() }); });

// Rutas públicas
app.use('/api/auth', loginLimiter, authRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/banners', bannersRouter);
app.use('/api/config', configRouter);
app.use('/api/checkout', checkoutLimiter, checkoutRouter);
app.use('/api/webhook', webhookRouter);
app.use('/sitemap.xml', sitemapRouter);

// Rutas admin (protegidas)
app.use('/api/admin/products', verifyAdmin, adminProductsRouter);
app.use('/api/admin/categories', verifyAdmin, adminCategoriesRouter);
app.use('/api/admin/banners', verifyAdmin, adminBannersRouter);
app.use('/api/admin/stock', verifyAdmin, adminStockRouter);
app.use('/api/admin/orders', verifyAdmin, adminOrdersRouter);
app.use('/api/admin/config', verifyAdmin, adminConfigRouter);

app.use(errorHandler);

const PORT = parseInt(process.env.PORT ?? '4000');
app.listen(PORT, () => console.log(`cristal-backend corriendo en puerto ${PORT}`));
