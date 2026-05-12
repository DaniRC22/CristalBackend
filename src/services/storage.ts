import { supabase } from '../lib/supabase';
import { processImage } from './imageProcessor';

interface StorageError {
  message: string;
  status?: number;
  statusCode?: number;
}

export async function uploadProductImage(
  file: Express.Multer.File,
  productId: number
): Promise<{ url: string; thumbUrl: string }> {
  try {
    console.log('🖼️ Procesando imagen de producto:', file.originalname);
    const { full, thumb } = await processImage(file.buffer);
    const timestamp = Date.now();
    const baseName = `products/${productId}/${timestamp}`;

    console.log('📤 Subiendo a Supabase bucket "product-images"');
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

    if (fullUpload.error) {
      console.error('❌ Error subiendo imagen completa:', fullUpload.error.message);
      throw new Error(`Error en imagen completa: ${fullUpload.error.message}`);
    }
    if (thumbUpload.error) {
      console.error('❌ Error subiendo thumbnail:', thumbUpload.error.message);
      throw new Error(`Error en thumbnail: ${thumbUpload.error.message}`);
    }

    const { data: fullData } = supabase.storage.from('product-images').getPublicUrl(`${baseName}.webp`);
    const { data: thumbData } = supabase.storage.from('product-images').getPublicUrl(`${baseName}_thumb.webp`);

    console.log('✅ Imágenes de producto subidas:', { fullUrl: fullData.publicUrl, thumbUrl: thumbData.publicUrl });
    return { url: fullData.publicUrl, thumbUrl: thumbData.publicUrl };
  } catch (err) {
    console.error('❌ Error en uploadProductImage:', err);
    throw err;
  }
}

export async function uploadBannerImage(file: Express.Multer.File): Promise<string> {
  try {
    const isVideo = ['mp4', 'webm', 'mov', 'avi'].includes(
      file.originalname.split('.').pop()?.toLowerCase() || ''
    );

    console.log(`${isVideo ? '🎬' : '🎨'} ${isVideo ? 'Video' : 'Imagen'}: ${file.originalname}`);

    let uploadBuffer = file.buffer;
    let contentType = file.mimetype;
    let ext = file.originalname.split('.').pop()?.toLowerCase() || 'webp';

    if (!isVideo) {
      console.log('🖼️ Procesando imagen...');
      const { full } = await processImage(file.buffer);
      uploadBuffer = full;
      contentType = 'image/webp';
      ext = 'webp';
      console.log('✅ Imagen procesada, size:', uploadBuffer.length, 'bytes');
    } else {
      console.log('✅ Video listo para subir, size:', uploadBuffer.length, 'bytes');
    }

    const path = `banners/${Date.now()}.${ext}`;
    console.log(`📤 Subiendo a Supabase bucket "banners": ${path}`);

    const { data, error } = await supabase.storage.from('banners').upload(path, uploadBuffer, {
      contentType,
      upsert: false,
    });

    if (error) {
      console.error('❌ Error en Supabase:', {
        message: error.message,
        status: (error as StorageError).status,
        statusCode: (error as StorageError).statusCode,
      });
      throw new Error(`Error subiendo a Supabase: ${error.message}`);
    }

    console.log('✅ Archivo subido a Supabase:', data);
    const { data: urlData } = supabase.storage.from('banners').getPublicUrl(path);
    console.log('✅ URL pública generada:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (err) {
    console.error('❌ Error en uploadBannerImage:', err);
    throw err;
  }
}

export async function uploadCategoryImage(file: Express.Multer.File): Promise<string> {
  try {
    console.log('🎨 Procesando imagen de categoría:', file.originalname);
    const { full } = await processImage(file.buffer);
    console.log('✅ Imagen procesada, size:', full.length, 'bytes');

    const path = `categories/${Date.now()}.webp`;
    console.log(`📤 Subiendo a Supabase bucket "categories": ${path}`);

    const { data, error } = await supabase.storage.from('categories').upload(path, full, {
      contentType: 'image/webp',
      upsert: false,
    });

    if (error) {
      console.error('❌ Error en Supabase:', {
        message: error.message,
        status: (error as StorageError).status,
        statusCode: (error as StorageError).statusCode,
      });
      throw new Error(`Error subiendo a Supabase: ${error.message}`);
    }

    console.log('✅ Archivo subido a Supabase:', data);
    const { data: urlData } = supabase.storage.from('categories').getPublicUrl(path);
    console.log('✅ URL pública generada:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (err) {
    console.error('❌ Error en uploadCategoryImage:', err);
    throw err;
  }
}

export async function deleteFromStorage(bucket: string, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}
