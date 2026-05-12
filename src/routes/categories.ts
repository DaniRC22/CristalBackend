import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { parsePage, parseLimit } from '../lib/pagination';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, slug, image_url, parent_id, order')
      .eq('active', true)
      .order('order');

    if (error) throw error;
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/:slug/products', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { page = '1', limit = '20', minPrice, maxPrice, search } = req.query as Record<string, string>;

    const { data: category, error: catError } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', slug)
      .single();

    if (catError || !category) {
      res.status(404).json({ error: 'Categoría no encontrada' });
      return;
    }

    const pg = parsePage(page);
    const lim = parseLimit(limit);
    const offset = (pg - 1) * lim;
    let query = supabase
      .from('products')
      .select('id, name, slug, price, transfer_discount_pct, stock, product_images(url, thumb_url, is_primary)', { count: 'exact' })
      .eq('category_id', category.id)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + lim - 1);

    if (minPrice) query = query.gte('price', minPrice);
    if (maxPrice) query = query.lte('price', maxPrice);
    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data, total: count, page: pg, limit: lim });
  } catch (err) {
    next(err);
  }
});

export default router;
