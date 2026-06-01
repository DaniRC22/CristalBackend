import crypto from 'crypto';

// Token de capacidad para cancelar UNA orden. /api/checkout/:id/cancel es
// público (el frontend lo llama al volver de MP sin auth de admin); sin token,
// un atacante podría enumerar IDs secuenciales y cancelar órdenes ajenas.
//
// La clave se deriva del service-role key (secreto, alta entropía, siempre
// presente) para no exigir otra variable de entorno. El token no se almacena
// en DB: se recalcula y se compara.
const KEY = crypto
  .createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  .update('order-cancel-token-v1')
  .digest();

export function orderCancelToken(orderId: number): string {
  return crypto.createHmac('sha256', KEY).update(`cancel:${orderId}`).digest('hex');
}

export function verifyOrderCancelToken(orderId: number, token: string): boolean {
  const expected = orderCancelToken(orderId);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
