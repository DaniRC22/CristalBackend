import { Router } from 'express';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { supabase } from '../../lib/supabase';
import { parsePage, parseLimit } from '../../lib/pagination';
import type { OrderStatus } from '../../types';

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! });

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, status, date } = req.query as Record<string, string>;
    const pg = parsePage(page);
    const lim = parseLimit(limit);
    const offset = (pg - 1) * lim;

    let query = supabase
      .from('orders')
      .select('id, status, total, customer_name, customer_email, customer_phone, mp_payment_id, payment_method, shipping_method, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + lim - 1);

    if (status) query = query.eq('status', status);
    if (date) {
      query = query
        .gte('created_at', `${date}T00:00:00.000Z`)
        .lte('created_at', `${date}T23:59:59.999Z`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ data, total: count, page: pg, limit: lim });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(id, quantity, unit_price, selected_options, products(id, name, slug))')
      .eq('id', req.params.id)
      .single();

    if (error || !data) { res.status(404).json({ error: 'Orden no encontrada' }); return; }
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('status')
      .eq('id', req.params.id)
      .single();

    if (!order) { res.status(404).json({ error: 'Orden no encontrada' }); return; }
    if (order.status !== 'cancelled') { res.status(400).json({ error: 'Solo se pueden eliminar órdenes canceladas' }); return; }

    await supabase.from('order_items').delete().eq('order_id', req.params.id);
    await supabase.from('orders').delete().eq('id', req.params.id);

    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/verify-payment', async (req, res, next) => {
  try {
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, payment_method, mp_payment_id')
      .eq('id', req.params.id)
      .single();

    if (orderError || !order) { res.status(404).json({ error: 'Orden no encontrada' }); return; }
    if (order.status !== 'pending') { res.json({ updated: false, reason: 'La orden no está pendiente' }); return; }
    if (!['mercadopago', 'mercado_credito'].includes(order.payment_method ?? '')) {
      res.json({ updated: false, reason: 'La orden no es de MercadoPago' }); return;
    }

    const mpPayment = new Payment(mpClient);
    let paymentStatus: string | null = null;
    let paymentId: string | null = order.mp_payment_id ?? null;

    if (paymentId) {
      const data = await mpPayment.get({ id: paymentId });
      paymentStatus = data.status ?? null;
    } else {
      // Buscar por external_reference
      const result = await mpPayment.search({ options: { external_reference: String(order.id) } });
      const found = result.results?.find((p) => p.status === 'approved') ?? result.results?.[0];
      if (found) {
        paymentId = String(found.id);
        paymentStatus = found.status ?? null;
      }
    }

    if (!paymentStatus) { res.json({ updated: false, reason: 'No se encontró el pago en MercadoPago' }); return; }

    if (paymentId) {
      await supabase.from('orders').update({ mp_payment_id: paymentId }).eq('id', order.id);
    }

    if (paymentStatus === 'approved') {
      await supabase.rpc('approve_order', { p_order_id: order.id });
      res.json({ updated: true, payment_status: paymentStatus });
    } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
      await supabase.from('orders').update({ status: 'cancelled' as OrderStatus }).eq('id', order.id);
      res.json({ updated: true, payment_status: paymentStatus });
    } else {
      res.json({ updated: false, reason: `El pago está en estado "${paymentStatus}"` });
    }
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body as { status: OrderStatus };
    const VALID_STATUSES: OrderStatus[] = ['pending', 'approved', 'cancelled'];
    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Estado inválido' });
      return;
    }

    if (status === 'cancelled') {
      // cancel_order restaura el stock atomicamente
      await supabase.rpc('cancel_order', { p_order_id: parseInt(req.params.id) });
      const { data, error } = await supabase.from('orders').select().eq('id', req.params.id).single();
      if (error) throw error;
      res.json(data);
      return;
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
