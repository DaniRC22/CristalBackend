-- ================================================================
-- 1. Habilitar RLS en orders y order_items
--    El backend usa service_role key → bypasea RLS.
--    Sin políticas de lectura pública: nadie externo puede ver órdenes.
-- ================================================================
alter table orders     enable row level security;
alter table order_items enable row level security;

-- ================================================================
-- 2. Revocar ejecución pública de funciones SECURITY DEFINER
--    El service_role siempre tiene EXECUTE y no se ve afectado.
-- ================================================================
revoke execute on function reserve_stock(int) from public, anon, authenticated;
revoke execute on function cancel_order(int)   from public, anon, authenticated;
revoke execute on function approve_order(int)  from public, anon, authenticated;

-- ================================================================
-- 3. Recrear funciones con search_path fijo
--    Previene ataques de search_path injection.
--    Se usan nombres calificados (public.*) dentro de cada función.
-- ================================================================
create or replace function reserve_stock(p_order_id int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products p
    set stock = p.stock - oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = p.id;

  if exists (
    select 1 from public.products p
    join public.order_items oi on oi.product_id = p.id
    where oi.order_id = p_order_id and p.stock < 0
  ) then
    update public.products p
      set stock = p.stock + oi.quantity
      from public.order_items oi
      where oi.order_id = p_order_id
        and oi.product_id = p.id;
    raise exception 'Stock insuficiente para uno o más productos';
  end if;
end;
$$;

create or replace function cancel_order(p_order_id int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.orders where id = p_order_id;

  if v_status is null or v_status = 'cancelled' then
    return;
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;

  update public.products p
    set stock = p.stock + oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = p.id;
end;
$$;

create or replace function approve_order(p_order_id int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orders
    set status = 'approved'
    where id = p_order_id and status = 'pending';
end;
$$;
