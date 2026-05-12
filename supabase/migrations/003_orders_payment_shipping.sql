alter table orders add column if not exists payment_method text default 'mercadopago';
alter table orders add column if not exists shipping_method text default 'retiro';
