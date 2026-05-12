import { Router } from 'express';
import { supabase } from '../lib/supabase';
import type { SiteConfigRow } from '../types';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from('site_config').select('key, value');
    if (error) throw error;

    const config = Object.fromEntries(data.map((row: SiteConfigRow) => [row.key, row.value]));
    res.json(config);
  } catch (err) {
    next(err);
  }
});

export default router;
