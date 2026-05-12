-- Habilitar extensión para slugs con caracteres especiales
create extension if not exists unaccent;

-- Categorías
create table categories (
  id        serial primary key,
  name      text not null,
  slug      text unique not null,
  image_url text,
  parent_id int references categories(id) on delete set null,
  "order"   int default 0,
  active    boolean default true
);

-- Productos
create table products (
  id                    serial primary key,
  name                  text not null,
  slug                  text unique not null,
  description           text,
  category_id           int references categories(id) on delete set null,
  price                 numeric(12,2) not null,
  transfer_discount_pct int default null,
  stock                 int default 0,
  low_stock_threshold   int default 5,
  active                boolean default true,
  featured              boolean default false,
  created_at            timestamptz default now()
);

-- Imágenes de productos
create table product_images (
  id         serial primary key,
  product_id int references products(id) on delete cascade,
  url        text not null,
  thumb_url  text,
  "order"    int default 0,
  is_primary boolean default false
);

-- Banners del home
create table banners (
  id        serial primary key,
  title     text,
  subtitle  text,
  image_url text not null,
  link_url  text,
  "order"   int default 0,
  active    boolean default true
);

-- Configuración del sitio (clave/valor)
create table site_config (
  key   text primary key,
  value text
);

-- Valores iniciales de configuración
insert into site_config (key, value) values
  ('whatsapp', ''),
  ('phone', ''),
  ('email', ''),
  ('instagram', ''),
  ('facebook', ''),
  ('about_text', ''),
  ('shipping_text', '');

-- Órdenes
create table orders (
  id             serial primary key,
  mp_payment_id  text,
  status         text default 'pending' check (status in ('pending','approved','cancelled')),
  total          numeric(12,2) not null,
  customer_name  text not null,
  customer_email text not null,
  customer_phone text,
  created_at     timestamptz default now()
);

-- Items de orden
create table order_items (
  id         serial primary key,
  order_id   int references orders(id) on delete cascade,
  product_id int references products(id) on delete set null,
  quantity   int not null,
  unit_price numeric(12,2) not null
);

-- ================================================================
-- RLS (Row Level Security)
-- ================================================================

alter table categories    enable row level security;
alter table products      enable row level security;
alter table product_images enable row level security;
alter table banners       enable row level security;
alter table site_config   enable row level security;
alter table orders        enable row level security;
alter table order_items   enable row level security;

-- Lectura pública para catálogo y config
create policy "public_read_categories"    on categories    for select using (true);
create policy "public_read_products"      on products      for select using (true);
create policy "public_read_product_images" on product_images for select using (true);
create policy "public_read_banners"       on banners       for select using (true);
create policy "public_read_site_config"   on site_config   for select using (true);

-- El backend usa service_role key → bypasea RLS automáticamente.
-- No se necesitan políticas de escritura para el backend.

-- ================================================================
-- Función RPC: aprobar orden + decrementar stock (atómico)
-- ================================================================

create or replace function approve_order(p_order_id int)
returns void
language plpgsql
security definer
as $$
begin
  update orders
    set status = 'approved'
    where id = p_order_id;

  update products p
    set stock = p.stock - oi.quantity
    from order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = p.id;
end;
$$;

-- ================================================================
-- Índices
-- ================================================================

create index idx_products_category_id on products(category_id);
create index idx_products_active       on products(active);
create index idx_products_featured     on products(featured);
create index idx_product_images_product_id on product_images(product_id);
create index idx_orders_status         on orders(status);
create index idx_order_items_order_id  on order_items(order_id);
