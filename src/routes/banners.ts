import { Router } from 'express';
import { supabase } from '../lib/supabase';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('banners')
      .select('id, title, subtitle, image_url, link_url, order')
      .eq('active', true)
      .order('order');

    if (error) throw error;
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
