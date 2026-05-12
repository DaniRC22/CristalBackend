import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../../lib/supabase';
import { uploadCategoryImage } from '../../services/storage';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    console.log('📝 POST /admin/categories - Creando nueva categoría');
    const { name, parent_id, order, active } = req.body;
    console.log('📋 Datos recibidos:', { name, parent_id, order, active });

    const slug = name
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    console.log('🏷️ Slug generado:', slug);

    let imageUrl: string | undefined;
    if (req.file) {
      console.log('🖼️ Imagen detectada:', req.file.originalname);
      imageUrl = await uploadCategoryImage(req.file);
      console.log('✅ Imagen subida. URL:', imageUrl);
    }

    console.log('💾 Insertando categoría en Supabase:', { name, slug, image_url: imageUrl, parent_id, order, active });
    const { data, error } = await supabase
      .from('categories')
      .insert({ name, slug, image_url: imageUrl, parent_id: parent_id || null, order: order ?? 0, active: active !== 'false' })
      .select()
      .single();

    if (error) {
      console.error('❌ Error insertando categoría:', error.message);
      throw error;
    }

    console.log('✅ Categoría creada exitosamente:', data);
    res.status(201).json(data);
  } catch (err) {
    console.error('❌ Error en POST /admin/categories:', err);
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
