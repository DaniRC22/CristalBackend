-- Hace la función approve_order idempotente:
-- solo aprueba si la orden está en estado 'pending', nunca ejecuta dos veces.
create or replace function approve_order(p_order_id int)
returns void
language plpgsql
security definer
as $$
begin
  -- Verificar que la orden existe y está pendiente antes de proceder
  if not exists (
    select 1 from orders where id = p_order_id and status = 'pending'
  ) then
    return;
  end if;

  update orders
    set status = 'approved'
    where id = p_order_id and status = 'pending';

  update products p
    set stock = p.stock - oi.quantity
    from order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = p.id;
end;
$$;
