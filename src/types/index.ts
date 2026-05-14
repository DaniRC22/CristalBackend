// ── Tipos de dominio ────────────────────────────────────────────────────────

export type PaymentMethod = 'transfer' | 'presencial' | 'mercadopago' | 'mercado_credito';
export type ShippingMethod = 'retiro' | 'flete';
export type OrderStatus = 'pending' | 'approved' | 'cancelled';
export type StockStatus = 'ok' | 'low' | 'out';

// ── Request / body types ────────────────────────────────────────────────────

export interface CheckoutItem {
  product_id: number;
  quantity: number;
  selected_options?: Record<string, string>;
}

export interface CheckoutBody {
  items: CheckoutItem[];
  first_name: string;
  last_name: string;
  customer_email: string;
  customer_phone: string;
  address: string;
  address2?: string;
  city: string;
  province: string;
  postal_code: string;
  payment_method: PaymentMethod;
  shipping_method: ShippingMethod;
  shipping_first_name?: string;
  shipping_last_name?: string;
  shipping_address?: string;
  shipping_address2?: string;
  shipping_city?: string;
  shipping_province?: string;
  shipping_postal_code?: string;
}

// ── DB response types ───────────────────────────────────────────────────────

export interface DBProduct {
  id: number;
  name: string;
  price: number | string;
  stock: number;
  transfer_discount_pct: number | null;
  product_images: { url: string; is_primary: boolean }[];
}

export interface DBOrderItem {
  id: number;
  quantity: number;
  unit_price: number;
  products: { id: number; name: string; slug: string } | null;
}

export interface DBOrder {
  id: number;
  status: OrderStatus;
  total: number;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  mp_payment_id?: string;
  address?: string;
  address2?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  payment_method?: PaymentMethod;
  shipping_method?: ShippingMethod;
  shipping_first_name?: string;
  shipping_last_name?: string;
  shipping_address?: string;
  shipping_address2?: string;
  shipping_city?: string;
  shipping_province?: string;
  shipping_postal_code?: string;
  created_at: string;
  order_items?: DBOrderItem[];
}

export interface DBStockProduct {
  id: number;
  name: string;
  stock: number;
  low_stock_threshold: number;
  categories: { name: string } | null;
}

export interface SiteConfigRow {
  key: string;
  value: string;
}

export interface DBCategory {
  slug: string;
}

export interface DBProductSlug {
  slug: string;
  created_at: string;
}
