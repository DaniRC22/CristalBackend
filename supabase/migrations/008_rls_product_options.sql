alter table product_options enable row level security;

create policy "public_read_product_options"
  on product_options for select using (true);
