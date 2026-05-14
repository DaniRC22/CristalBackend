alter table orders
  add column if not exists shipping_first_name  text,
  add column if not exists shipping_last_name   text,
  add column if not exists shipping_address     text,
  add column if not exists shipping_address2    text,
  add column if not exists shipping_city        text,
  add column if not exists shipping_province    text,
  add column if not exists shipping_postal_code text;
