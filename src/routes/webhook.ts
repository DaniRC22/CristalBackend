import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { supabase } from '../lib/supabase';

const router = Router();

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! });

// HMAC strict mode: rechaza con 400 si la firma no matchea.
// En soft mode (default) loguea warning y sigue: confiamos en la verificación
// contra la API de MP. Activar strict cuando MP confirme que el secret del
// panel funciona correctamente.
const HMAC_STRICT = process.env.MP_WEBHOOK_HMAC_STRICT === 'true';
const APP_NAME = process.env.MP_APP_NAME ?? 'cristal-backend';

router.post('/mp', async (req: Request, res: Response) => {
  console.log('[WH] ── INICIO ──────────────────────────────');
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : JSON.stringify(req.body);
    const parsed = JSON.parse(rawBody) as { type: string; data: { id: string }; action?: string };

    console.log('[WH] headers x-signature:', req.headers['x-signature'] ?? '(ausente)');
    console.log('[WH] headers x-request-id:', req.headers['x-request-id'] ?? '(ausente)');
    console.log('[WH] query:', JSON.stringify(req.query));
    console.log('[WH] body:', rawBody.slice(0, 300));

    // IPN antiguas (topic=payment/merchant_order) — devolver 200 para evitar reintentos.
    // Para merchant_order hacemos fire-and-forget contra la API de MP solo para LOG:
    // así vemos en consola los intentos de pago rechazados (status_detail) sin
    // tener que pedirle el código al cliente. La lógica real sigue en el webhook
    // v2 de type=payment más abajo.
    const q = req.query as Record<string, unknown>;
    if (q['topic']) {
      const topic = String(q['topic']);
      if (topic === 'merchant_order') {
        const resource = (parsed as unknown as { resource?: string })?.resource;
        const moId = q['id'] ? String(q['id']) : undefined;
        if (resource ?? moId) {
          void fetchAndLogMerchantOrder(resource, moId);
        }
      }
      console.log(`[WH] IPN topic=${topic}, ignorando para procesamiento`);
      res.sendStatus(200);
      return;
    }

    const { type, data, action } = parsed;

    // Filtro rápido: data.id debe ser numérico (todos los payment IDs de MP lo son).
    // Evita una llamada a MP por basura/scans.
    if (!data?.id || !/^\d+$/.test(String(data.id))) {
      console.warn('[WH] data.id inválido o ausente, ignorando');
      res.sendStatus(200);
      return;
    }

    if (type !== 'payment') {
      console.log('[WH] tipo ignorado:', type);
      res.sendStatus(200);
      return;
    }

    // Verificar firma HMAC.
    // Soft mode (default): si falla, loguea warning y sigue — la verificación
    // real ocurre al consultar el payment con la API de MP usando nuestro access_token.
    // Strict mode: rechaza con 400.
    const secret = process.env.MP_WEBHOOK_SECRET;
    let hmacValid = true;
    if (secret && secret !== 'dummy_webhook_secret') {
      hmacValid = verifyHmac(req, secret, String(data.id));
      if (!hmacValid) {
        console.warn(`[WH] HMAC FAILED — ${HMAC_STRICT ? 'rechazando' : 'continuando con verificación de API'}`);
        if (HMAC_STRICT) {
          res.status(400).json({ error: 'Firma inválida' });
          return;
        }
      } else {
        console.log('[WH] HMAC OK');
      }
    } else {
      console.log('[WH] HMAC desactivado (dummy/no secret)');
    }

    console.log(`[WH] type=${type} action=${action} data.id=${data.id}`);

    // Consultar el pago contra la API de MP. Esto es lo que valida que el
    // webhook sea legítimo: si data.id no existe en nuestra cuenta, MP devuelve 404.
    const payment = new Payment(mpClient);
    const paymentData = await payment.get({ id: data.id });
    console.log(`[WH] pago id=${data.id} status=${paymentData.status} amount=${paymentData.transaction_amount} ref=${paymentData.external_reference}`);

    // Defensa en profundidad: si la preference fue creada por nuestra app,
    // el payment debe tener metadata.source con el APP_NAME. Si está presente
    // y no matchea, no es nuestra. Si no hay metadata (preference vieja), procesamos
    // igual para no romper compat.
    const sourceMeta = (paymentData.metadata as Record<string, unknown> | undefined)?.source;
    if (sourceMeta !== undefined && sourceMeta !== APP_NAME) {
      console.warn(`[WH] metadata.source no coincide (got=${sourceMeta}, expected=${APP_NAME}), ignorando`);
      res.sendStatus(200);
      return;
    }

    const orderId = parseInt(paymentData.external_reference ?? '0');
    if (!orderId) {
      console.warn('[WH] external_reference inválido:', paymentData.external_reference);
      res.sendStatus(200);
      return;
    }

    // Cargar la orden y validar que existe + está pending antes de hacer cualquier cosa.
    const { data: order } = await supabase
      .from('orders')
      .select('id, total, status')
      .eq('id', orderId)
      .single();

    if (!order) {
      console.warn(`[WH] orden ${orderId} no existe, ignorando`);
      res.sendStatus(200);
      return;
    }
    if (order.status !== 'pending') {
      console.log(`[WH] orden ${orderId} ya está ${order.status}, ignorando (idempotente)`);
      res.sendStatus(200);
      return;
    }

    if (paymentData.status === 'approved' || paymentData.status === 'authorized') {
      const paidAmount = paymentData.transaction_amount ?? 0;
      const orderTotal = Number(order.total ?? 0);

      // El pago debe ser en pesos. Sin este chequeo, un pago aprobado en otra
      // moneda con un monto numéricamente cercano al total ARS pasaría el filtro.
      if (paymentData.currency_id !== 'ARS') {
        console.warn(`[WH] FRAUDE: orden ${orderId} moneda inesperada ${paymentData.currency_id}`);
        res.sendStatus(200);
        return;
      }

      // Rechaza pagos insuficientes (margen de $1 por redondeo). El sobrepago
      // no es fraude, así que solo validamos el límite inferior.
      if (paidAmount + 1 < orderTotal) {
        console.warn(`[WH] FRAUDE: orden ${orderId} total=${orderTotal} pago=${paidAmount}`);
        res.sendStatus(200);
        return;
      }

      // mp_payment_id solo se persiste cuando el pago aprueba. Una preference
      // admite múltiples intentos; guardar el id en cada webhook (incluso
      // rejected) cancelaría incorrectamente reintentos exitosos posteriores
      // y dejaría has_payment=true bloqueando la cancelación manual.
      await supabase
        .from('orders')
        .update({ mp_payment_id: String(paymentData.id) })
        .eq('id', orderId);

      const { error: approveErr } = await supabase.rpc('approve_order', { p_order_id: orderId });
      if (approveErr) console.error('[WH] approve_order error:', approveErr);
      else console.log(`[WH] orden ${orderId} aprobada`);
    } else if (paymentData.status === 'rejected' || paymentData.status === 'cancelled') {
      // No cancelamos la orden ante un payment rejected: la preference admite
      // múltiples intentos y el cliente puede aprobar en el siguiente. La
      // cancelación real se dispara cuando el cliente vuelve a la failure URL
      // (POST /api/checkout/:id/cancel) o por expiración.
      console.log(`[WH] payment ${data.id} ${paymentData.status}, orden ${orderId} sigue pending por si reintenta`);
    } else if (paymentData.status === 'in_process' || paymentData.status === 'pending') {
      console.log(`[WH] orden ${orderId} pago en proceso (status=${paymentData.status}), esperando resolución`);
    } else {
      console.warn(`[WH] orden ${orderId} status no manejado: ${paymentData.status}`);
    }

    console.log('[WH] ── FIN OK ────────────────────────────');
    res.sendStatus(200);
  } catch (err) {
    console.error('[WH] ERROR:', err);
    res.sendStatus(200);
  }
});

// Consulta la merchant_order en la API de MP y loguea su status y los intentos
// de pago asociados. Solo para visibilidad — no toca la DB ni cambia estado.
// Fire-and-forget desde el handler del webhook: si falla (timeout, 5xx de MP, etc.)
// solo loguea warning, no propaga.
async function fetchAndLogMerchantOrder(resource: string | undefined, moId: string | undefined): Promise<void> {
  const url = resource ?? (moId ? `https://api.mercadopago.com/merchant_orders/${moId}` : null);
  if (!url) return;
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[WH] merchant_order fetch ${response.status}: ${url}`);
      return;
    }
    const mo = await response.json() as {
      id: number;
      status: string;
      order_status: string;
      total_amount?: number;
      external_reference?: string;
      payments?: Array<{
        id: number;
        status: string;
        status_detail?: string;
        transaction_amount?: number;
        payment_method_id?: string;
        payment_type_id?: string;
      }>;
    };
    console.log(`[WH] merchant_order ${mo.id} status=${mo.status} order_status=${mo.order_status} total=${mo.total_amount} ref=${mo.external_reference}`);
    if (mo.payments?.length) {
      for (const p of mo.payments) {
        console.log(`[WH] └ payment ${p.id} ${p.status} detail=${p.status_detail ?? '?'} method=${p.payment_method_id ?? '?'} type=${p.payment_type_id ?? '?'} amount=${p.transaction_amount ?? '?'}`);
      }
    } else {
      console.log('[WH] └ (sin intentos de pago aún)');
    }
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    console.warn(`[WH] merchant_order fetch failed: ${e.name === 'AbortError' ? 'timeout' : e.message ?? String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

function verifyHmac(req: Request, secret: string, dataId: string): boolean {
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  const sig = Array.isArray(xSignature) ? xSignature[0] : xSignature;
  const reqId = Array.isArray(xRequestId) ? xRequestId[0] : xRequestId;

  if (!sig || !reqId) {
    console.warn('[WH] HMAC: faltan headers de firma');
    return false;
  }

  const parts = sig.split(',').map((p) => p.trim());
  const ts = parts.find((s) => s.startsWith('ts='))?.slice(3);
  const v1 = parts.find((s) => s.startsWith('v1='))?.slice(3);

  if (!ts || !v1) {
    console.warn('[WH] HMAC: formato de x-signature inválido:', sig);
    return false;
  }

  const signedManifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
  const computed = crypto.createHmac('sha256', secret).update(signedManifest).digest('hex');

  if (process.env.NODE_ENV !== 'production') {
    console.log('[WH] HMAC manifest:', signedManifest);
    console.log('[WH] HMAC calculado:', computed);
    console.log('[WH] HMAC recibido: ', v1);
  }

  // timingSafeEqual requiere buffers de la misma longitud
  if (computed.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
}

export default router;
