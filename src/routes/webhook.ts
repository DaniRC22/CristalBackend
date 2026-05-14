import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { supabase } from '../lib/supabase';

const router = Router();

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! });

router.post('/mp', async (req: Request, res: Response) => {
  console.log('[WH] ── INICIO ──────────────────────────────');
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : JSON.stringify(req.body);
    const parsed = JSON.parse(rawBody) as { type: string; data: { id: string } };

    console.log('[WH] headers x-signature:', req.headers['x-signature'] ?? '(ausente)');
    console.log('[WH] headers x-request-id:', req.headers['x-request-id'] ?? '(ausente)');
    console.log('[WH] query:', JSON.stringify(req.query));
    console.log('[WH] body:', rawBody.slice(0, 300));

    // IPN antiguas (topic=payment/merchant_order) — devolver 200 para evitar reintentos
    const q = req.query as Record<string, unknown>;
    if (q['topic']) {
      console.log('[WH] IPN antigua (topic), ignorando');
      res.sendStatus(200);
      return;
    }

    // Verificar firma HMAC — obligatorio en producción
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (secret && secret !== 'dummy_webhook_secret') {
      const xSignature = req.headers['x-signature'] as string;
      const xRequestId = req.headers['x-request-id'] as string;
      const dataId = (q['data.id'] as string) || ((q['data'] as Record<string, string>)?.id);

      if (!xSignature || !xRequestId) {
        console.warn('[WH] HMAC: faltan headers de firma');
        res.status(400).json({ error: 'Firma requerida' });
        return;
      }

      const parts = xSignature.split(',');
      const ts = parts.find(s => s.startsWith('ts='))?.slice(3);
      const v1 = parts.find(s => s.startsWith('v1='))?.slice(3);

      if (!ts || !v1) {
        console.warn('[WH] HMAC: formato de x-signature inválido:', xSignature);
        res.status(400).json({ error: 'Formato de firma inválido' });
        return;
      }

      const signedManifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
      const hmac = crypto.createHmac('sha256', secret).update(signedManifest).digest('hex');
      console.log('[WH] HMAC manifest:', signedManifest);
      console.log('[WH] HMAC calculado:', hmac);
      console.log('[WH] HMAC recibido: ', v1);

      if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1))) {
        console.warn('[WH] HMAC FAILED — firma inválida');
        res.status(400).json({ error: 'Firma inválida' });
        return;
      }
      console.log('[WH] HMAC OK');
    } else {
      console.log('[WH] HMAC desactivado (dummy secret)');
    }

    const { type, data, action } = parsed as { type: string; data: { id: string }; action?: string };
    console.log(`[WH] type=${type} action=${action} data.id=${data?.id}`);

    if (type !== 'payment') {
      console.log('[WH] tipo ignorado:', type);
      res.sendStatus(200);
      return;
    }

    const payment = new Payment(mpClient);
    const paymentData = await payment.get({ id: data.id });
    console.log(`[WH] pago id=${data.id} status=${paymentData.status} amount=${paymentData.transaction_amount} ref=${paymentData.external_reference}`);

    const orderId = parseInt(paymentData.external_reference ?? '0');
    if (!orderId) {
      console.warn('[WH] external_reference inválido:', paymentData.external_reference);
      res.sendStatus(200);
      return;
    }

    await supabase
      .from('orders')
      .update({ mp_payment_id: String(paymentData.id) })
      .eq('id', orderId);

    if (paymentData.status === 'approved' || paymentData.status === 'authorized') {
      const { data: order } = await supabase
        .from('orders')
        .select('total')
        .eq('id', orderId)
        .single();

      const paidAmount = paymentData.transaction_amount ?? 0;
      const orderTotal = Number(order?.total ?? 0);

      if (order && Math.abs(paidAmount - orderTotal) > 1) {
        console.warn(`[WH] FRAUDE: orden ${orderId} total=${orderTotal} pago=${paidAmount}`);
        res.sendStatus(200);
        return;
      }

      const { error: approveErr } = await supabase.rpc('approve_order', { p_order_id: orderId });
      if (approveErr) console.error('[WH] approve_order error:', approveErr);
      else console.log(`[WH] orden ${orderId} aprobada`);
    } else if (paymentData.status === 'rejected' || paymentData.status === 'cancelled') {
      const { error: cancelErr } = await supabase.rpc('cancel_order', { p_order_id: orderId });
      if (cancelErr) console.error('[WH] cancel_order error:', cancelErr);
      else console.log(`[WH] orden ${orderId} cancelada`);
    }

    console.log('[WH] ── FIN OK ────────────────────────────');
    res.sendStatus(200);
  } catch (err) {
    console.error('[WH] ERROR:', err);
    res.sendStatus(200);
  }
});

export default router;
