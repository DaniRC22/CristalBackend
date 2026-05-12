import { Router } from 'express';
import { supabase } from '../../lib/supabase';
import type { DBStockProduct, StockStatus } from '../../types';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { filter, search } = req.query as Record<string, string>;

    let query = supabase
      .from('products')
      .select('id, name, stock, low_stock_threshold, categories(name)')
      .order('name');

    if (search) query = query.ilike('name', `%${search}%`);
    if (filter === 'out') query = query.eq('stock', 0);
    const { data, error } = await query;
    if (error) throw error;

    const withStatus = (data as DBStockProduct[] ?? []).map((p) => ({
      ...p,
      status: (p.stock === 0 ? 'out' : p.stock <= p.low_stock_threshold ? 'low' : 'ok') as StockStatus,
    }));

    const result = filter === 'low'
      ? withStatus.filter((p) => p.status === 'low')
      : withStatus;

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/:productId', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      res.status(400).json({ error: 'ID de producto inválido' });
      return;
    }

    const { stock, low_stock_threshold } = req.body as { stock?: unknown; low_stock_threshold?: unknown };
    const updates: Record<string, number> = {};

    if (stock !== undefined) {
      const s = Number(stock);
      if (!Number.isInteger(s) || s < 0 || s > 999_999) {
        res.status(400).json({ error: 'El stock debe ser un entero entre 0 y 999.999' });
        return;
      }
      updates.stock = s;
    }

    if (low_stock_threshold !== undefined) {
      const t = Number(low_stock_threshold);
      if (!Number.isInteger(t) || t < 0) {
        res.status(400).json({ error: 'El umbral debe ser un entero no negativo' });
        return;
      }
      updates.low_stock_threshold = t;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No hay campos para actualizar' });
      return;
    }

    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', productId)
      .select('id, name, stock, low_stock_threshold')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
