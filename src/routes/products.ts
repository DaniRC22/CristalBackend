import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { parsePage, parseLimit } from '../lib/pagination';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const {
      page = '1',
      limit = '20',
      category,
      minPrice,
      maxPrice,
      search,
    } = req.query as Record<string, string>;

    const offset = (parsePage(page) - 1) * parseLimit(limit);
    let query = supabase
      .from('products')
      .select(
        'id, name, slug, price, transfer_discount_pct, stock, category_id, categories(name, slug), product_images(url, thumb_url, is_primary)',
        { count: 'exact' }
      )
      .eq('active', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (category) {
      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', category)
        .single();
      if (cat) query = query.eq('category_id', cat.id);
    }
    if (minPrice) query = query.gte('price', minPrice);
    if (maxPrice) query = query.lte('price', maxPrice);
    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    res.set('Cache-Control', 'public, max-age=30, s-maxage=120');
    res.json({ data, total: count, page: parsePage(page), limit: parseLimit(limit) });
  } catch (err) {
    next(err);
  }
});

router.get('/featured', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, slug, price, transfer_discount_pct, stock, product_images(url, thumb_url, is_primary)')
      .eq('active', true)
      .eq('featured', true)
      .order('created_at', { ascending: false })
      .limit(8);

    if (error) throw error;
    res.set('Cache-Control', 'public, max-age=30, s-maxage=120');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*, categories(name, slug), product_images(id, url, thumb_url, order, is_primary), product_options(id, name, values, sort_order)')
      .eq('slug', req.params.slug)
      .eq('active', true)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Producto no encontrado' });
      return;
    }

    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
