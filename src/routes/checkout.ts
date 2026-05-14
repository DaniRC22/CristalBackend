import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { createPreference } from '../services/mercadopago';
import type { PaymentMethod, ShippingMethod, CheckoutItem, CheckoutBody, DBProduct } from '../types';

const router = Router();

const VALID_PAYMENT_METHODS: PaymentMethod[] = ['transfer', 'presencial', 'mercadopago', 'mercado_credito'];
const VALID_SHIPPING_METHODS: ShippingMethod[] = ['retiro', 'flete'];
const MP_METHODS: PaymentMethod[] = ['mercadopago', 'mercado_credito'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const MAX_ITEMS = 50;
const MAX_QUANTITY = 999;
const MAX_STR: Record<string, number> = {
  first_name: 80, last_name: 80, customer_email: 254, customer_phone: 30,
  address: 200, address2: 100, city: 100, province: 80, postal_code: 10,
};

function validateBody(body: Record<string, unknown>): string | null {
  if (!Array.isArray(body.items) || body.items.length === 0)
    return 'El carrito está vacío';
  if (body.items.length > MAX_ITEMS)
    return 'Demasiados productos en el carrito';

  for (const item of body.items as unknown[]) {
    const i = item as Record<string, unknown>;
    if (!Number.isInteger(i.product_id) || (i.product_id as number) <= 0)
      return 'ID de producto inválido';
    if (!Number.isInteger(i.quantity) || (i.quantity as number) <= 0)
      return 'Cantidad de producto inválida';
    if ((i.quantity as number) > MAX_QUANTITY)
      return 'Cantidad de producto excede el máximo permitido';
    if (i.selected_options !== undefined && i.selected_options !== null) {
      if (typeof i.selected_options !== 'object' || Array.isArray(i.selected_options))
        return 'Opciones de producto inválidas';
      const opts = i.selected_options as Record<string, unknown>;
      if (Object.keys(opts).length > 10) return 'Demasiadas opciones de producto';
      for (const [k, v] of Object.entries(opts)) {
        if (typeof k !== 'string' || k.length > 50) return 'Nombre de opción inválido';
        if (typeof v !== 'string' || (v as string).length > 100) return 'Valor de opción inválido';
      }
    }
  }

  for (const [field, max] of Object.entries(MAX_STR)) {
    const val = str(body[field]);
    if (val.length > max) return `El campo ${field} excede la longitud máxima`;
  }

  if (!str(body.first_name)) return 'El nombre es requerido';
  if (!str(body.last_name)) return 'El apellido es requerido';

  const email = str(body.customer_email);
  if (!email) return 'El email es requerido';
  if (!EMAIL_RE.test(email)) return 'El email no es válido';

  if (!str(body.customer_phone)) return 'El teléfono es requerido';
  if (!str(body.address)) return 'La dirección es requerida';
  if (!str(body.city)) return 'La ciudad es requerida';
  if (!str(body.province)) return 'La provincia es requerida';
  if (!str(body.postal_code)) return 'El código postal es requerido';

  if (!VALID_PAYMENT_METHODS.includes(body.payment_method as PaymentMethod))
    return 'Método de pago inválido';
  if (!VALID_SHIPPING_METHODS.includes(body.shipping_method as ShippingMethod))
    return 'Método de envío inválido';

  return null;
}

router.post('/', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;

    const validationError = validateBody(body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const {
      items,
      first_name,
      last_name,
      customer_email,
      customer_phone,
      address,
      address2,
      city,
      province,
      postal_code,
      payment_method = 'mercadopago',
      shipping_method = 'retiro',
      shipping_first_name,
      shipping_last_name,
      shipping_address,
      shipping_address2,
      shipping_city,
      shipping_province,
      shipping_postal_code,
    } = body as unknown as CheckoutBody;

    const customer_name = `${str(first_name)} ${str(last_name)}`.trim();

    // Obtener productos y validar stock
    const productIds = (items as CheckoutItem[]).map((i) => i.product_id);
    const { data: rawProducts, error: prodError } = await supabase
      .from('products')
      .select('id, name, price, stock, transfer_discount_pct, product_images(url, is_primary)')
      .in('id', productIds)
      .eq('active', true);

    const products = rawProducts as DBProduct[] | null;

    if (prodError) throw prodError;

    for (const item of items as CheckoutItem[]) {
      const product = products?.find((p) => p.id === item.product_id);
      if (!product) {
        res.status(400).json({ error: `Producto ${item.product_id} no encontrado o inactivo` });
        return;
      }
      if (product.stock < item.quantity) {
        res.status(400).json({ error: `Stock insuficiente para "${product.name}"` });
        return;
      }
    }

    const isTransfer = payment_method === 'transfer';
    const total = (items as CheckoutItem[]).reduce((sum, item) => {
      const product = products!.find((p) => p.id === item.product_id)!;
      const basePrice = Number(product.price);
      const discountedPrice =
        isTransfer && product.transfer_discount_pct
          ? basePrice * (1 - product.transfer_discount_pct / 100)
          : basePrice;
      return sum + discountedPrice * item.quantity;
    }, 0);

    // Crear orden
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_name,
        customer_email: str(customer_email),
        customer_phone: str(customer_phone),
        address: str(address),
        address2: str(address2 ?? ''),
        city: str(city),
        province: str(province),
        postal_code: str(postal_code),
        total,
        status: 'pending',
        payment_method,
        shipping_method,
        ...(shipping_first_name && {
          shipping_first_name: str(shipping_first_name),
          shipping_last_name:  str(shipping_last_name ?? ''),
          shipping_address:    str(shipping_address ?? ''),
          shipping_address2:   str(shipping_address2 ?? ''),
          shipping_city:       str(shipping_city ?? ''),
          shipping_province:   str(shipping_province ?? ''),
          shipping_postal_code: str(shipping_postal_code ?? ''),
        }),
      })
      .select('id')
      .single();

    if (orderError || !order) throw orderError;

    let stockReserved = false;
    const deleteOrder = async () => {
      if (stockReserved) await supabase.rpc('cancel_order', { p_order_id: order.id });
      await supabase.from('order_items').delete().eq('order_id', order.id);
      await supabase.from('orders').delete().eq('id', order.id);
    };

    // Insertar items
    const orderItems = (items as CheckoutItem[]).map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: products!.find((p) => p.id === item.product_id)!.price,
      selected_options: item.selected_options ?? null,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
    if (itemsError) {
      await deleteOrder();
      throw itemsError;
    }

    // Reservar stock atómicamente — si hay race condition esto falla con excepción
    const { error: stockError } = await supabase.rpc('reserve_stock', { p_order_id: order.id });
    if (stockError) {
      await deleteOrder();
      res.status(409).json({ error: stockError.message.includes('Stock insuficiente') ? stockError.message : 'No se pudo reservar el stock' });
      return;
    }
    stockReserved = true;

    // Para pagos no-MP devolvemos la orden directamente
    if (!MP_METHODS.includes(payment_method as PaymentMethod)) {
      res.json({ order_id: order.id, needs_mp: false });
      return;
    }

    // Crear preferencia MP
    const mpItems = (items as CheckoutItem[]).map((item) => {
      const product = products!.find((p) => p.id === item.product_id)!;
      const primaryImage = (product.product_images as { url: string; is_primary: boolean }[])
        ?.find((img) => img.is_primary);
      return {
        id: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: item.quantity,
        imageUrl: primaryImage?.url,
      };
    });

    const frontendUrl = process.env.FRONTEND_URL!;
    let preferenceId: string;
    let initPoint: string;
    try {
      const result = await createPreference(mpItems, order.id, frontendUrl, {
        firstName: str(first_name),
        lastName: str(last_name),
        email: str(customer_email),
        phone: str(customer_phone),
        address: str(address),
        city: str(city),
        province: str(province),
        postalCode: str(postal_code),
      });
      preferenceId = result.preferenceId;
      initPoint = result.initPoint;
    } catch (mpErr) {
      await deleteOrder();
      throw mpErr;
    }

    res.json({ order_id: order.id, preference_id: preferenceId, init_point: initPoint, needs_mp: true });
  } catch (err) {
    next(err);
  }
});

export default router;
