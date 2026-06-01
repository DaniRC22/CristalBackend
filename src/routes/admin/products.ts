import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../../lib/supabase';
import { uploadProductImage } from '../../services/storage';
import { parsePage, parseLimit } from '../../lib/pagination';

const router = Router();

const VALID_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!VALID_IMAGE_MIMES.includes(file.mimetype)) {
      cb(new Error('Tipo de archivo inválido. Solo se permiten JPEG, PNG, WebP y GIF'));
      return;
    }
    cb(null, true);
  },
});

function parsePositiveInt(val: unknown): number | null {
  const n = parseInt(String(val));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function validateProductFields(body: Record<string, unknown>): string | null {
  const { name, price, stock, low_stock_threshold, transfer_discount_pct, description } = body;

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return 'El nombre es requerido';
    if (name.trim().length > 255) return 'El nombre excede 255 caracteres';
  }

  if (price !== undefined) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0 || p > 99_999_999) return 'El precio debe ser un número positivo';
  }

  if (stock !== undefined) {
    const s = Number(stock);
    if (!Number.isInteger(s) || s < 0 || s > 999_999) return 'El stock debe ser un entero no negativo';
  }

  if (low_stock_threshold !== undefined) {
    const t = Number(low_stock_threshold);
    if (!Number.isInteger(t) || t < 0) return 'El umbral de stock debe ser un entero no negativo';
  }

  if (transfer_discount_pct !== undefined && transfer_discount_pct !== null && transfer_discount_pct !== '') {
    const d = Number(transfer_discount_pct);
    if (!Number.isFinite(d) || d < 0 || d > 100) return 'El descuento debe estar entre 0 y 100';
  }

  if (description !== undefined && typeof description === 'string' && description.length > 10_000) {
    return 'La descripción excede el límite de 10.000 caracteres';
  }

  return null;
}

// Listar productos
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, search } = req.query as Record<string, string>;
    const pg = parsePage(page);
    const lim = parseLimit(limit);
    const offset = (pg - 1) * lim;

    let query = supabase
      .from('products')
      .select('id, name, slug, price, transfer_discount_pct, stock, low_stock_threshold, active, featured, category_id, categories(name), product_images(url, thumb_url, is_primary)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + lim - 1);

    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ data, total: count, page: pg, limit: lim });
  } catch (err) {
    next(err);
  }
});

// Obtener un producto
router.get('/:id', async (req, res, next) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) { res.status(400).json({ error: 'ID inválido' }); return; }

    const { data, error } = await supabase
      .from('products')
      .select('*, categories(name, slug), product_images(id, url, thumb_url, order, is_primary), product_options(id, name, values, prices, price_mode, sort_order)')
      .eq('id', id)
      .single();

    if (error || !data) { res.status(404).json({ error: 'No encontrado' }); return; }
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Crear producto
router.post('/', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const { name, description, category_id, price, transfer_discount_pct, stock, low_stock_threshold, active, featured } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'El nombre es requerido' });
      return;
    }
    if (price === undefined || price === null || isNaN(Number(price))) {
      res.status(400).json({ error: 'El precio es requerido' });
      return;
    }

    const validationError = validateProductFields(body);
    if (validationError) { res.status(400).json({ error: validationError }); return; }

    const slug = (name as string).trim()
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const { data, error } = await supabase
      .from('products')
      .insert({ name: (name as string).trim(), description, category_id, price, transfer_discount_pct, stock, low_stock_threshold, active, featured, slug })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// Actualizar producto
router.put('/:id', async (req, res, next) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) { res.status(400).json({ error: 'ID inválido' }); return; }

    const body = req.body as Record<string, unknown>;
    const { name, description, category_id, price, transfer_discount_pct, stock, low_stock_threshold, active, featured } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'El nombre es requerido' });
      return;
    }

    const validationError = validateProductFields(body);
    if (validationError) { res.status(400).json({ error: validationError }); return; }

    const slug = (name as string)
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const { data, error } = await supabase
      .from('products')
      .update({ name, slug, description, category_id, price, transfer_discount_pct, stock, low_stock_threshold, active, featured })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Eliminar producto
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) { res.status(400).json({ error: 'ID inválido' }); return; }

    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Subir imagen
router.post('/:id/images', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Imagen requerida' }); return; }

    const productId = parsePositiveInt(req.params.id);
    if (!productId) { res.status(400).json({ error: 'ID inválido' }); return; }

    const { url, thumbUrl } = await uploadProductImage(req.file, productId);

    const isPrimary = req.body.is_primary === 'true';
    const orderVal = parseInt(req.body.order ?? '0');

    if (isPrimary) {
      await supabase.from('product_images').update({ is_primary: false }).eq('product_id', productId);
    }

    const { data, error } = await supabase
      .from('product_images')
      .insert({ product_id: productId, url, thumb_url: thumbUrl, order: orderVal, is_primary: isPrimary })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// Eliminar imagen
router.delete('/:id/images/:imgId', async (req, res, next) => {
  try {
    const id = parsePositiveInt(req.params.id);
    const imgId = parsePositiveInt(req.params.imgId);
    if (!id || !imgId) { res.status(400).json({ error: 'ID inválido' }); return; }

    const { error } = await supabase
      .from('product_images')
      .delete()
      .eq('id', imgId)
      .eq('product_id', id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Opciones de producto ────────────────────────────────────────────────────

router.get('/:id/options', async (req, res, next) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) { res.status(400).json({ error: 'ID inválido' }); return; }

    const { data, error } = await supabase
      .from('product_options')
      .select('*')
      .eq('product_id', id)
      .order('sort_order');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Normaliza un array de precios opcional. Devuelve:
//   - undefined si el caller no mandó nada (no tocar la columna)
//   - [] si el caller mandó pero todos los precios son inválidos/cero/vacíos
//   - array de mismo length que values, con number positivo o null por posición
function normalizePrices(rawPrices: unknown, valuesLen: number): (number | null)[] | undefined {
  if (rawPrices === undefined) return undefined;
  if (!Array.isArray(rawPrices)) return [];
  if (rawPrices.length === 0) return [];

  // Si vino con length distinto a values, asumimos "no overrides" para no romper.
  if (rawPrices.length !== valuesLen) return [];

  const cleaned = rawPrices.map((p) => {
    if (p === null || p === undefined || p === '') return null;
    const n = typeof p === 'number' ? p : parseFloat(String(p));
    if (!Number.isFinite(n) || n <= 0) return null;
    // Cap razonable para evitar overflow / errores de tipeo
    if (n > 99_999_999) return null;
    return Math.round(n * 100) / 100;
  });

  // Si todos quedaron null, devolver [] para mantener el caso "sin overrides"
  if (cleaned.every((p) => p === null)) return [];
  return cleaned;
}

const VALID_PRICE_MODES = new Set(['override', 'addon']);

function normalizePriceMode(raw: unknown): 'override' | 'addon' | undefined {
  if (typeof raw !== 'string') return undefined;
  return VALID_PRICE_MODES.has(raw) ? (raw as 'override' | 'addon') : undefined;
}

router.post('/:id/options', async (req, res, next) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) { res.status(400).json({ error: 'ID inválido' }); return; }

    const { name, values, prices, price_mode, sort_order } = req.body as {
      name: string; values: string[]; prices?: unknown; price_mode?: unknown; sort_order?: number;
    };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'El nombre de la opción es requerido' });
      return;
    }
    if (!Array.isArray(values) || values.length === 0) {
      res.status(400).json({ error: 'La opción debe tener al menos un valor' });
      return;
    }
    const cleanValues = values.map((v) => String(v).trim()).filter(Boolean).slice(0, 50);
    const cleanPrices = normalizePrices(prices, cleanValues.length) ?? [];
    const cleanMode = normalizePriceMode(price_mode) ?? 'override';

    const { data, error } = await supabase
      .from('product_options')
      .insert({
        product_id: id,
        name: name.trim(),
        values: cleanValues,
        prices: cleanPrices,
        price_mode: cleanMode,
        sort_order: sort_order ?? 0,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/options/:optId', async (req, res, next) => {
  try {
    const id = parsePositiveInt(req.params.id);
    const optId = parsePositiveInt(req.params.optId);
    if (!id || !optId) { res.status(400).json({ error: 'ID inválido' }); return; }

    const { name, values, prices, price_mode, sort_order } = req.body as {
      name?: string; values?: string[]; prices?: unknown; price_mode?: unknown; sort_order?: number;
    };
    const cleanValues = Array.isArray(values)
      ? values.map((v) => String(v).trim()).filter(Boolean).slice(0, 50)
      : undefined;
    // Si cambian los values y no mandan prices, reseteamos prices a [] para
    // evitar que el constraint length-match falle (prices viejo puede tener
    // length distinto al values nuevo).
    const cleanPrices = cleanValues !== undefined
      ? (normalizePrices(prices, cleanValues.length) ?? [])
      : normalizePrices(prices, 0);
    const cleanMode = normalizePriceMode(price_mode);

    const { data, error } = await supabase
      .from('product_options')
      .update({
        ...(name !== undefined && { name }),
        ...(cleanValues !== undefined && { values: cleanValues }),
        ...(cleanPrices !== undefined && { prices: cleanPrices }),
        ...(cleanMode !== undefined && { price_mode: cleanMode }),
        ...(sort_order !== undefined && { sort_order }),
      })
      .eq('id', optId)
      .eq('product_id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/options/:optId', async (req, res, next) => {
  try {
    const id = parsePositiveInt(req.params.id);
    const optId = parsePositiveInt(req.params.optId);
    if (!id || !optId) { res.status(400).json({ error: 'ID inválido' }); return; }

    const { error } = await supabase
      .from('product_options')
      .delete()
      .eq('id', optId)
      .eq('product_id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
