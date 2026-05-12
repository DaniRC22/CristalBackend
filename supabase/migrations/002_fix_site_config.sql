-- site_config no contiene datos de usuarios, solo configuración pública.
-- Deshabilitamos RLS para que el backend pueda escribir sin restricciones.
alter table site_config disable row level security;

-- Limpiar claves obsoletas que ya no se usan en el admin
delete from site_config where key in ('about_text', 'shipping_text');
