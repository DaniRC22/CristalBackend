-- reserve_stock: descuenta stock atómicamente al crear la orden.
-- Si algún producto quedaría con stock negativo, revierte y lanza error.
create or replace function reserve_stock(p_order_id int)
returns void
language plpgsql
security definer
as $$
begin
  update products p
    set stock = p.stock - oi.quantity
    from order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = p.id;

  if exists (
    select 1 from products p
    join order_items oi on oi.product_id = p.id
    where oi.order_id = p_order_id and p.stock < 0
  ) then
    -- Revertir el decremento antes de lanzar el error
    update products p
      set stock = p.stock + oi.quantity
      from order_items oi
      where oi.order_id = p_order_id
        and oi.product_id = p.id;
    raise exception 'Stock insuficiente para uno o más productos';
  end if;
end;
$$;

-- cancel_order: restaura stock y cancela la orden.
-- Funciona desde cualquier estado no-cancelado (pending o approved).
create or replace function cancel_order(p_order_id int)
returns void
language plpgsql
security definer
as $$
declare
  v_status text;
begin
  select status into v_status from orders where id = p_order_id;

  if v_status is null or v_status = 'cancelled' then
    return;
  end if;

  update orders set status = 'cancelled' where id = p_order_id;

  update products p
    set stock = p.stock + oi.quantity
    from order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = p.id;
end;
$$;

-- approve_order: simplificado — solo actualiza el estado.
-- El stock ya fue descontado por reserve_stock al crear la orden.
create or replace function approve_order(p_order_id int)
returns void
language plpgsql
security definer
as $$
begin
  update orders
    set status = 'approved'
    where id = p_order_id and status = 'pending';
end;
$$;
