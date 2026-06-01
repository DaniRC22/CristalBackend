import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../../lib/supabase';
import { uploadCategoryImage } from '../../services/storage';

const router = Router();

// Solo imágenes: rechaza tipos arbitrarios antes de subirlos a Storage.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.includes(file.mimetype)),
});

router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('order');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    const { name, parent_id, order, active } = req.body;

    const slug = name
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    let imageUrl: string | undefined;
    if (req.file) {
      imageUrl = await uploadCategoryImage(req.file);
    }

    const { data, error } = await supabase
      .from('categories')
      .insert({ name, slug, image_url: imageUrl, parent_id: parent_id || null, order: order ?? 0, active: active !== 'false' })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', upload.single('image'), async (req, res, next) => {
  try {
    const updates: Record<string, unknown> = { ...req.body };
    if (req.file) updates.image_url = await uploadCategoryImage(req.file);

    const { data, error } = await supabase
      .from('categories')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('categories').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
