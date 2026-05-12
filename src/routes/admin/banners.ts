import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../../lib/supabase';
import { uploadBannerImage } from '../../services/storage';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from('banners').select('*').order('order');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Imagen requerida' });
      return;
    }

    const imageUrl = await uploadBannerImage(req.file);
    const { title, subtitle, link_url, order, active } = req.body;

    const { data, error } = await supabase
      .from('banners')
      .insert({ title, subtitle, image_url: imageUrl, link_url, order: Number(order ?? 0), active: active !== 'false' })
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
    if (req.file) updates.image_url = await uploadBannerImage(req.file);

    // FormData siempre envía strings; convertir al tipo correcto antes de persistir
    if ('active' in updates) updates.active = updates.active === 'true';
    if ('order' in updates) updates.order = Number(updates.order);

    const { data, error } = await supabase
      .from('banners')
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
    const { data: deleted, error } = await supabase
      .from('banners')
      .delete()
      .eq('id', req.params.id)
      .select('image_url');

    if (error) throw error;

    // Limpiar imagen de Storage (best-effort, no falla si el archivo no existe)
    for (const banner of deleted ?? []) {
      if (banner.image_url) {
        const parts = (banner.image_url as string).split('/storage/v1/object/public/banners/');
        if (parts.length > 1) {
          await supabase.storage.from('banners').remove([parts[1]]).catch(() => {});
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
