# 📦 Configuración de Buckets en Supabase

## ❌ Problema Actual
Las imágenes no se están cargando en los buckets de Supabase. Necesitan crear los siguientes buckets:

## ✅ Buckets Requeridos

### 1. **banners**
- Usado para: Imágenes de banners del home
- Permisos: Público (lectura permitida)

### 2. **product-images**
- Usado para: Imágenes de productos
- Permisos: Público (lectura permitida)

### 3. **categories**
- Usado para: Imágenes de categorías
- Permisos: Público (lectura permitida)

## 🔧 Pasos para Crear los Buckets

1. Ve a https://supabase.com
2. Entra a tu proyecto en Supabase
3. En el menú izquierdo → **Storage**
4. Haz clic en **+ New bucket** para cada uno:

### Para cada bucket:
- **Name**: (ej: `banners`)
- **Public bucket**: ✅ Activar (para poder ver las imágenes)
- Crear

## 📋 Política de Seguridad (RLS)

Después de crear cada bucket, ve a **Policies** y verifica que:
- ✅ Permitir SELECT (lectura) para `anon` (público)
- ✅ Permitir INSERT (subida) para usuarios autenticados
- ✅ Permitir UPDATE para usuarios autenticados
- ✅ Permitir DELETE para usuarios autenticados

### Política recomendada para escritura:
```sql
-- Permitir que usuarios autenticados suban archivos
create policy "Allow authenticated uploads"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'banners');
```

## 🧪 Cómo Probar

1. Inicia el backend: `npm run dev`
2. Intenta subir un banner en `/admin/banners`
3. Abre la consola del servidor (terminal)
4. Busca los logs:
   - `📤 Subiendo a Supabase bucket...`
   - `✅ URL pública generada` (éxito)
   - `❌ Error en Supabase` (problema)

## 🔍 Si Sigue Fallando

Revisa:
1. ¿Los buckets existen?
2. ¿El bucket está marcado como "Public"?
3. ¿Tienes permiso de lectura pública?
4. ¿La clave SUPABASE_SERVICE_ROLE_KEY es correcta en `.env`?

Verifica que la URL y la clave en tu archivo `.env` coincidan con tu proyecto Supabase.
