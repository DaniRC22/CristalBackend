-- ================================================================
-- Fix: la migración 009 revocó EXECUTE de public/anon/authenticated.
-- En Supabase eso también afecta a service_role para estas funciones
-- (no había grant explícito a service_role).
-- Sin este permiso el webhook de MP no puede aprobar órdenes:
--   approve_order error: 'permission denied for function approve_order'
-- ================================================================

grant execute on function reserve_stock(int) to service_role;
grant execute on function cancel_order(int)  to service_role;
grant execute on function approve_order(int) to service_role;
