import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { supabase } from '../lib/supabase';

const router = Router();

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! });

router.post('/mp', async (req: Request, res: Response) => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : JSON.stringify(req.body);
    const parsed = JSON.parse(rawBody) as { type: string; data: { id: string } };

    if (process.env.NODE_ENV !== 'production') {
      console.log('WEBHOOK query:', JSON.stringify(req.query));
      console.log('WEBHOOK body:', rawBody.slice(0, 200));
    }

    // IPN antiguas (topic=payment/merchant_order) — devolver 200 para evitar reintentos
    const q = req.query as Record<string, unknown>;
    if (q['topic']) {
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
        res.status(400).json({ error: 'Firma requerida' });
        return;
      }

      const parts = xSignature.split(',');
      const ts = parts.find(s => s.startsWith('ts='))?.slice(3);
      const v1 = parts.find(s => s.startsWith('v1='))?.slice(3);

      if (!ts || !v1) {
        res.status(400).json({ error: 'Formato de firma inválido' });
        return;
      }

      const signedManifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
      const hmac = crypto.createHmac('sha256', secret).update(signedManifest).digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1))) {
        console.warn('WEBHOOK HMAC FAILED — firma inválida');
        res.status(400).json({ error: 'Firma inválida' });
        return;
      }
    }

    const { type, data, action } = parsed as { type: string; data: { id: string }; action?: string };

    if (type !== 'payment') {
      res.sendStatus(200);
      return;
    }

    const payment = new Payment(mpClient);
    const paymentData = await payment.get({ id: data.id });
    console.log(`WEBHOOK payment action=${action} id=${data.id} status=${paymentData.status}`);

    const orderId = parseInt(paymentData.external_reference ?? '0');
    if (!orderId) {
      res.sendStatus(200);
      return;
    }

    await supabase
      .from('orders')
      .update({ mp_payment_id: String(paymentData.id) })
      .eq('id', orderId);

    if (paymentData.status === 'approved') {
      const { data: order } = await supabase
        .from('orders')
        .select('total')
        .eq('id', orderId)
        .single();

      const paidAmount = paymentData.transaction_amount ?? 0;
      const orderTotal = Number(order?.total ?? 0);

      if (order && Math.abs(paidAmount - orderTotal) > 1) {
        console.warn(`WEBHOOK FRAUDE: orden ${orderId} total=${orderTotal} pero pago=${paidAmount}`);
        res.sendStatus(200);
        return;
      }

      await supabase.rpc('approve_order', { p_order_id: orderId });
    } else if (paymentData.status === 'rejected' || paymentData.status === 'cancelled') {
      await supabase.rpc('cancel_order', { p_order_id: orderId });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200); // Siempre 200 para que MP no reintente indefinidamente
  }
});

export default router;
