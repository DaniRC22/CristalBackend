import { supabase } from '../lib/supabase';
import { processImage } from './imageProcessor';

export async function uploadProductImage(
  file: Express.Multer.File,
  productId: number
): Promise<{ url: string; thumbUrl: string }> {
  const { full, thumb } = await processImage(file.buffer);
  const timestamp = Date.now();
  const baseName = `products/${productId}/${timestamp}`;

  const [fullUpload, thumbUpload] = await Promise.all([
    supabase.storage.from('product-images').upload(`${baseName}.webp`, full, {
      contentType: 'image/webp',
      upsert: false,
    }),
    supabase.storage.from('product-images').upload(`${baseName}_thumb.webp`, thumb, {
      contentType: 'image/webp',
      upsert: false,
    }),
  ]);

  if (fullUpload.error) throw new Error(`Error en imagen completa: ${fullUpload.error.message}`);
  if (thumbUpload.error) throw new Error(`Error en thumbnail: ${thumbUpload.error.message}`);

  const { data: fullData } = supabase.storage.from('product-images').getPublicUrl(`${baseName}.webp`);
  const { data: thumbData } = supabase.storage.from('product-images').getPublicUrl(`${baseName}_thumb.webp`);

  return { url: fullData.publicUrl, thumbUrl: thumbData.publicUrl };
}

export async function uploadBannerImage(file: Express.Multer.File): Promise<string> {
  const isVideo = ['mp4', 'webm', 'mov', 'avi'].includes(
    file.originalname.split('.').pop()?.toLowerCase() || ''
  );

  let uploadBuffer = file.buffer;
  let contentType = file.mimetype;
  let ext = file.originalname.split('.').pop()?.toLowerCase() || 'webp';

  if (!isVideo) {
    const { full } = await processImage(file.buffer);
    uploadBuffer = full;
    contentType = 'image/webp';
    ext = 'webp';
  }

  const path = `banners/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('banners').upload(path, uploadBuffer, {
    contentType,
    upsert: false,
  });

  if (error) throw new Error(`Error subiendo a Supabase: ${error.message}`);

  const { data: urlData } = supabase.storage.from('banners').getPublicUrl(path);
  return urlData.publicUrl;
}

export async function uploadCategoryImage(file: Express.Multer.File): Promise<string> {
  const { full } = await processImage(file.buffer);
  const path = `categories/${Date.now()}.webp`;

  const { error } = await supabase.storage.from('categories').upload(path, full, {
    contentType: 'image/webp',
    upsert: false,
  });

  if (error) throw new Error(`Error subiendo a Supabase: ${error.message}`);

  const { data: urlData } = supabase.storage.from('categories').getPublicUrl(path);
  return urlData.publicUrl;
}

export async function deleteFromStorage(bucket: string, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}
