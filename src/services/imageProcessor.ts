import sharp from 'sharp';

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
}

export async function processImage(buffer: Buffer): Promise<ProcessedImage> {
  const [full, thumb] = await Promise.all([
    sharp(buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer(),
    sharp(buffer)
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer(),
  ]);

  return { full, thumb };
}
