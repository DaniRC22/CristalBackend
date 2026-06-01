-- ================================================================
-- 1. site_config: eliminar policy permisiva que permitía a anon
--    (frontend con anon key pública) modificar la configuración del
--    sitio. Sólo lectura pública; los writes van por el backend con
--    service_role, que bypassa RLS.
-- ================================================================
drop policy if exists allow_all on public.site_config;

create policy public_read_site_config on public.site_config
  for select to public using (true);

revoke all on public.site_config from anon, authenticated;
grant select on public.site_config to anon, authenticated;

-- ================================================================
-- 2. orders / order_items: eliminar completamente del Data API.
--    Sólo accesibles vía backend (service_role).
-- ================================================================
revoke all on public.orders      from anon, authenticated;
revoke all on public.order_items from anon, authenticated;

-- ================================================================
-- 3. Catálogo público: SELECT-only para anon/authenticated.
--    Defense in depth: aunque las policies ya limitan a SELECT, los
--    grants quedaban abiertos a INSERT/UPDATE/DELETE.
-- ================================================================
revoke all on public.products        from anon, authenticated;
revoke all on public.categories      from anon, authenticated;
revoke all on public.banners         from anon, authenticated;
revoke all on public.product_images  from anon, authenticated;
revoke all on public.product_options from anon, authenticated;

grant select on public.products        to anon, authenticated;
grant select on public.categories      to anon, authenticated;
grant select on public.banners         to anon, authenticated;
grant select on public.product_images  to anon, authenticated;
grant select on public.product_options to anon, authenticated;
