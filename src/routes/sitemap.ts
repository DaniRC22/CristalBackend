import { Router } from 'express';
import { supabase } from '../lib/supabase';
import type { DBCategory, DBProductSlug } from '../types';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const baseUrl = process.env.FRONTEND_URL ?? 'https://cristalequipamientos.com';

    const { data: products } = await supabase
      .from('products')
      .select('slug, created_at')
      .eq('active', true);

    const { data: categories } = await supabase
      .from('categories')
      .select('slug')
      .eq('active', true);

    const staticPages = ['', 'productos', 'categorias', 'nosotros', 'envios', 'contacto'];

    const urls = [
      ...staticPages.map((p) => `<url><loc>${baseUrl}/${p}</loc><changefreq>weekly</changefreq><priority>${p === '' ? '1.0' : '0.8'}</priority></url>`),
      ...(categories ?? []).map((c: DBCategory) => `<url><loc>${baseUrl}/categorias/${c.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
      ...(products ?? []).map((p: DBProductSlug) => `<url><loc>${baseUrl}/productos/${p.slug}</loc><lastmod>${new Date(p.created_at).toISOString().slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;

    res.header('Content-Type', 'application/xml').send(xml);
  } catch (err) {
    next(err);
  }
});

export default router;
