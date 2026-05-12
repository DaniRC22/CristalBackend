import 'dotenv/config';
import express from 'express';
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

app.use(helmet());

// CORS — rechaza peticiones de orígenes no permitidos
const allowedOrigin = process.env.FRONTEND_URL;
app.use(cors({
  origin: (origin, cb) => {
    // Permitir requests sin origin (server-to-server, Postman en dev)
    if (!origin || origin === allowedOrigin) return cb(null, true);
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

// El webhook de MP necesita el body crudo para verificar la firma
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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
app.listen(PORT, () => console.log(`kap-backend corriendo en puerto ${PORT}`));
