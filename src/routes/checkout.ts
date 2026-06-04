import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { createPreference, createPayment, MPPaymentError } from '../services/mercadopago';
import { verifyOrderCancelToken, orderCancelToken } from '../lib/orderToken';
import { randomUUID } from 'crypto';
import type { PaymentMethod, ShippingMethod, CheckoutItem, CheckoutBody, DBProduct, DBProductOption } from '../types';

// Calcula el precio efectivo de un item dado el producto base y sus opciones
// seleccionadas. Combina dos modos:
//
//   - 'override': el precio del valor REEMPLAZA al base. Si hay varios
//     overrides activos (ej: medida=$10000 y otra opción con override $5500),
//     gana el MAX. Defensivo: nunca undercharge.
//
//   - 'addon': el precio del valor se SUMA al base (o al override ganador
//     si lo hay). Ej: color cromado +$500. Se suman todos los addons
//     seleccionados con precio.
//
// Fórmula final: max(base, max(overrides_seleccionados)) + sum(addons_seleccionados)
function effectiveUnitPrice(
  basePrice: number,
  selectedOptions: Record<string, string> | null | undefined,
  productOptions: DBProductOption[] | undefined
): number {
  if (!selectedOptions || !productOptions || productOptions.length === 0) return basePrice;

  const overrides: number[] = [];
  let addonsSum = 0;

  for (const [optName, selectedVal] of Object.entries(selectedOptions)) {
    const opt = productOptions.find((o) => o.name === optName);
    if (!opt || !Array.isArray(opt.prices) || opt.prices.length === 0) continue;
    const idx = opt.values.indexOf(selectedVal);
    if (idx === -1) continue;
    const raw = opt.prices[idx];
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;

    const mode = opt.price_mode ?? 'override';
    if (mode === 'addon') addonsSum += n;
    else overrides.push(n);
  }

  const base = overrides.length > 0 ? Math.max(...overrides) : basePrice;
  return base + addonsSum;
}

const router = Router();

const VALID_PAYMENT_METHODS: PaymentMethod[] = ['transfer', 'presencial', 'mercadopago', 'tarjeta'];
const VALID_SHIPPING_METHODS: ShippingMethod[] = ['retiro', 'flete'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const MAX_ITEMS = 50;
const MAX_QUANTITY = 999;
const MAX_NOTES = 1000;
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

  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== 'string') return 'Las notas deben ser texto';
    if ((body.notes as string).length > MAX_NOTES) return `Las notas exceden los ${MAX_NOTES} caracteres`;
  }

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
      notes,
    } = body as unknown as CheckoutBody;

    const customer_name = `${str(first_name)} ${str(last_name)}`.trim();

    // Obtener productos (con sus opciones para recalcular precios por variante)
    // y validar stock. product_options trae prices: si está vacío, el item usa
    // el precio base; si tiene valores, los selected_options del cliente
    // determinan qué override aplicar.
    const productIds = (items as CheckoutItem[]).map((i) => i.product_id);
    const { data: rawProducts, error: prodError } = await supabase
      .from('products')
      .select('id, name, price, stock, transfer_discount_pct, product_images(url, is_primary), product_options(name, values, prices, price_mode)')
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
    // Calculamos el precio efectivo de cada item (con override de variante si
    // aplica) UNA SOLA VEZ y lo cacheamos. Lo reusamos para el total, los
    // order_items.unit_price y los items de la preferencia de MP. Crítico:
    // nunca confiamos en el precio del frontend, siempre recalculamos en backend.
    const itemPrices = (items as CheckoutItem[]).map((item) => {
      const product = products!.find((p) => p.id === item.product_id)!;
      return effectiveUnitPrice(Number(product.price), item.selected_options, product.product_options);
    });
    const total = (items as CheckoutItem[]).reduce((sum, item, idx) => {
      const product = products!.find((p) => p.id === item.product_id)!;
      const variantPrice = itemPrices[idx];
      const discountedPrice =
        isTransfer && product.transfer_discount_pct
          ? variantPrice * (1 - product.transfer_discount_pct / 100)
          : variantPrice;
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
        ...(str(notes ?? '') && { notes: str(notes ?? '') }),
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

    // Insertar items con el precio efectivo (override de variante si aplica)
    const orderItems = (items as CheckoutItem[]).map((item, idx) => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: itemPrices[idx],
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
    if (payment_method !== 'mercadopago' && payment_method !== 'tarjeta') {
      res.json({ order_id: order.id, needs_mp: false });
      return;
    }

    // Para Checkout Bricks embebido (tarjeta de crédito/débito)
    if (payment_method === 'tarjeta') {
      res.json({ order_id: order.id, needs_brick: true });
      return;
    }

    // Crear preferencia MP
    const mpItems = (items as CheckoutItem[]).map((item, idx) => {
      const product = products!.find((p) => p.id === item.product_id)!;
      const primaryImage = (product.product_images as { url: string; is_primary: boolean }[])
        ?.find((img) => img.is_primary);
      return {
        id: product.id,
        name: product.name,
        price: itemPrices[idx],
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

// Procesa el pago enviado por el CardPayment Brick.
// El frontend llama esto desde el onSubmit del brick con el token de tarjeta.
router.post('/:id/pay', async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const { token, payment_method_id, installments, issuer_id, payer } =
      req.body as Record<string, unknown>;

    if (typeof token !== 'string' || !token)
      return void res.status(400).json({ error: 'token requerido' });
    if (typeof payment_method_id !== 'string' || !payment_method_id)
      return void res.status(400).json({ error: 'payment_method_id requerido' });
    if (!Number.isInteger(installments) || (installments as number) < 1)
      return void res.status(400).json({ error: 'installments inválido' });
    if (typeof payer !== 'object' || payer === null)
      return void res.status(400).json({ error: 'payer requerido' });

    const payerObj = payer as Record<string, unknown>;
    if (typeof payerObj.email !== 'string' || !payerObj.email)
      return void res.status(400).json({ error: 'payer.email requerido' });

    const payerFirstName = typeof payerObj.first_name === 'string' ? payerObj.first_name.trim().slice(0, 80) : undefined;
    const payerLastName  = typeof payerObj.last_name  === 'string' ? payerObj.last_name.trim().slice(0, 80)  : undefined;
    const payerPhone     = typeof payerObj.phone      === 'string' ? payerObj.phone.trim().slice(0, 30)      : undefined;

    let identification: { type: string; number: string } | undefined;
    if (payerObj.identification && typeof payerObj.identification === 'object') {
      const id = payerObj.identification as Record<string, unknown>;
      const idType = typeof id.type === 'string' ? id.type.trim().toUpperCase() : '';
      const idNumber = typeof id.number === 'string' ? id.number.replace(/\D/g, '') : '';
      if (idType && idNumber && idNumber.length >= 6 && idNumber.length <= 20) {
        identification = { type: idType, number: idNumber };
      }
    }

    // Cargamos la orden para verificar que existe, es pending y es de tipo MP
    const { data: order } = await supabase
      .from('orders')
      .select('id, total, status, payment_method')
      .eq('id', orderId)
      .single();

    if (!order) return void res.status(404).json({ error: 'Orden no encontrada' });
    if (order.payment_method !== 'mercadopago' && order.payment_method !== 'tarjeta')
      return void res.status(400).json({ error: 'La orden no usa pago con tarjeta' });
    if (order.status !== 'pending')
      return void res.status(409).json({ error: 'La orden ya fue procesada' });

    let result;
    try {
      result = await createPayment(
        {
          token: token as string,
          payment_method_id: payment_method_id as string,
          installments: installments as number,
          issuer_id: typeof issuer_id === 'number' ? issuer_id : undefined,
          payer: {
            email: payerObj.email as string,
            first_name: payerFirstName,
            last_name: payerLastName,
            phone: payerPhone,
            identification,
          },
        },
        orderId,
        Number(order.total),
        randomUUID()
      );
    } catch (err) {
      if (err instanceof MPPaymentError) {
        res.status(err.status >= 400 && err.status < 500 ? err.status : 400).json({
          error: err.message,
          causes: err.causes,
        });
        return;
      }
      throw err;
    }

    // El webhook de MP actualizará el estado de la orden. Aquí solo devolvemos
    // el resultado inmediato para que el frontend pueda redirigir al usuario.
    const frontendUrl = process.env.FRONTEND_URL!;
    const cancelToken = orderCancelToken(orderId);
    const redirectUrls = {
      approved: `${frontendUrl}/orden/${orderId}?status=success`,
      rejected: `${frontendUrl}/orden/${orderId}?status=failure&t=${cancelToken}`,
      pending:  `${frontendUrl}/orden/${orderId}?status=pending`,
    };

    res.json({
      payment_id: result.id,
      status: result.status,
      status_detail: result.status_detail,
      redirect_urls: redirectUrls,
    });
  } catch (err) {
    next(err);
  }
});

// Cancelación pública: cuando el cliente vuelve desde MP a back_urls.failure,
// el frontend llama acá para liberar el stock y marcar la orden como cancelada.
// Solo cancela órdenes que estén en pending y sin pago MP asociado: si llegó
// webhook con mp_payment_id, dejamos que el admin verifique manualmente.
// Requiere el token de cancelación (query `t`) que viaja en la failure URL:
// sin él cualquiera podría enumerar IDs y cancelar órdenes ajenas.
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const token = typeof req.query.t === 'string' ? req.query.t : '';
    if (!token || !verifyOrderCancelToken(orderId, token)) {
      res.status(403).json({ error: 'Token inválido' });
      return;
    }

    const { data: order } = await supabase
      .from('orders')
      .select('status, mp_payment_id')
      .eq('id', orderId)
      .single();

    if (!order) { res.status(404).json({ error: 'Orden no encontrada' }); return; }
    if (order.status !== 'pending') { res.json({ cancelled: false, reason: 'no_pending' }); return; }
    if (order.mp_payment_id) { res.json({ cancelled: false, reason: 'has_payment' }); return; }

    await supabase.rpc('cancel_order', { p_order_id: orderId });
    res.json({ cancelled: true });
  } catch (err) {
    next(err);
  }
});

export default router;
