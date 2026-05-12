import { Router } from 'express';
import { supabase } from '../../lib/supabase';
import type { SiteConfigRow } from '../../types';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from('site_config').select('key, value');
    if (error) throw error;
    res.json(Object.fromEntries(data.map((r: SiteConfigRow) => [r.key, r.value])));
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const entries = Object.entries(req.body as Record<string, string>).map(([key, value]) => ({ key, value }));

    const { error } = await supabase
      .from('site_config')
      .upsert(entries, { onConflict: 'key' });

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
