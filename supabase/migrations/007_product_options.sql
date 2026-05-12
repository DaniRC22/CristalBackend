-- Opciones de producto (Color, Talle, Material, etc.)
-- El stock sigue siendo a nivel de producto, no por variante.
create table product_options (
  id         serial primary key,
  product_id int not null references products(id) on delete cascade,
  name       text not null,                  -- e.g. "Color", "Talle"
  values     text[] not null default '{}',   -- e.g. {"Blanco","Negro","Piel"}
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create index product_options_product_id_idx on product_options(product_id);

alter table order_items
  add column selected_options jsonb;         -- e.g. {"Color":"Blanco","Talle":"M"}

-- Guardar la elección del cliente en cada ítem de la orden