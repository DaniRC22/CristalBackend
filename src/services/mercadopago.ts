import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { orderCancelToken } from '../lib/orderToken';

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN!,
});

const APP_NAME = process.env.MP_APP_NAME ?? 'cristal-backend';

// Parsea un teléfono argentino al formato { area_code, number } que espera MP.
// Si no se puede parsear con confianza, devuelve undefined: el antifraude de MP
// penaliza datos malformados más que la ausencia de datos.
//
// Casos cubiertos:
//   - Con código de país: +54 11 1234-5678 → area_code='11', number='12345678'
//   - Con prefijo móvil internacional: +549 261 534-5678 → area_code='261', number='5345678'
//   - Sin código de país, BA: 11 1234-5678 → area_code='11', number='12345678'
//   - Sin código de país, interior: 261 534-5678 → area_code='261', number='5345678'
//   - Cualquier otra cosa (muy corto, muy largo, formato raro) → undefined
export function parseArgPhone(raw: string | undefined | null): { area_code: string; number: string } | undefined {
  if (!raw) return undefined;
  let digits = raw.replace(/\D/g, '');

  // Sacar código de país si está
  if (digits.startsWith('549') && digits.length === 13) digits = digits.slice(3);
  else if (digits.startsWith('54') && digits.length === 12) digits = digits.slice(2);

  // Formato local argentino: 10 dígitos (area + número)
  if (digits.length !== 10) return undefined;

  // Buenos Aires AMBA: código de área "11" (2 dígitos), número de 8 dígitos
  if (digits.startsWith('11')) {
    return { area_code: '11', number: digits.slice(2) };
  }

  // Resto del país: código de área de 3 dígitos + 7 de número
  // (cubre la mayoría: Córdoba 351, Rosario 341, Mendoza 261, Mar del Plata 223, etc.)
  return { area_code: digits.slice(0, 3), number: digits.slice(3) };
}

// Separa una dirección libre en street_name + street_number cuando hay un
// número al final. MP/antifraude prefiere los campos separados para validar.
// "Av. Corrientes 1234" → { street_name: "Av. Corrientes", street_number: "1234" }
// "Calle sin número"    → { street_name: "Calle sin número" }
export function parseAddress(full: string | undefined | null): { street_name: string; street_number?: string } | undefined {
  if (!full) return undefined;
  const trimmed = full.trim();
  if (!trimmed) return undefined;

  const match = trimmed.match(/^(.+?)\s+(\d{1,6})\s*$/);
  if (match) {
    return { street_name: match[1].trim(), street_number: match[2] };
  }
  return { street_name: trimmed };
}

interface CartItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
}

interface Customer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
}

export async function createPreference(
  items: CartItem[],
  orderId: number,
  baseUrl: string,
  customer: Customer
): Promise<{ preferenceId: string; initPoint: string }> {
  const preference = new Preference(client);

  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const phone = parseArgPhone(customer.phone);
  const parsedAddress = parseAddress(customer.address);
  const zipDigits = customer.postalCode?.replace(/\D/g, '').slice(0, 8);

  const payerAddress = parsedAddress && zipDigits
    ? {
        street_name: parsedAddress.street_name,
        ...(parsedAddress.street_number && { street_number: parsedAddress.street_number }),
        zip_code: zipDigits,
      }
    : undefined;

  // additional_info mejora la tasa de aprobación de tarjetas (antifraude MP).
  // El tipo del SDK lo declara como string pero la API acepta objeto.
  const additionalInfo = {
    items: items.map((item) => ({
      id: String(item.id),
      title: item.name,
      description: item.name,
      quantity: item.quantity,
      unit_price: item.price,
      picture_url: item.imageUrl,
    })),
    payer: {
      first_name: customer.firstName,
      last_name: customer.lastName,
      ...(phone && { phone }),
      ...(payerAddress && { address: payerAddress }),
    },
    ...(payerAddress && {
      shipments: {
        receiver_address: {
          ...payerAddress,
          ...(customer.city && { city_name: customer.city }),
          ...(customer.province && { state_name: customer.province }),
        },
      },
    }),
  };

  try {
    const response = await preference.create({
      body: {
        statement_descriptor: 'Cristal Equipamiento',
        items: items.map((item) => ({
          id: String(item.id),
          title: item.name,
          description: item.name,
          quantity: item.quantity,
          unit_price: item.price,
          currency_id: 'ARS',
          picture_url: item.imageUrl,
        })),
        // No mandamos payer.email a propósito: si el cliente está logueado en
        // la app de MP con otra cuenta, MP entra en conflicto entre el email
        // de la preferencia y el del usuario logueado. Esto rompía pagos con
        // dinero en cuenta en mobile. El email del form se sigue guardando en
        // orders.customer_email para uso interno (comprobantes, contacto post-venta).
        payer: {
          name: customer.firstName,
          surname: customer.lastName,
          ...(phone && { phone }),
          ...(payerAddress && { address: payerAddress }),
        },
        additional_info: additionalInfo as unknown as string,
        ...(baseUrl.startsWith('https://') && { auto_return: 'approved' }),
        back_urls: {
          success: `${baseUrl}/orden/${orderId}?status=success`,
          // El token permite que la página de confirmación cancele esta orden
          // (y solo esta) al volver de un pago fallido.
          failure: `${baseUrl}/orden/${orderId}?status=failure&t=${orderCancelToken(orderId)}`,
          pending: `${baseUrl}/orden/${orderId}?status=pending`,
        },
        external_reference: String(orderId),
        notification_url: `${backendUrl}/api/webhook/mp`,
        metadata: {
          source: APP_NAME,
          order_id: orderId,
        },
      },
    });

    return { preferenceId: response.id!, initPoint: response.init_point! };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; cause?: unknown };
    console.error('[MP] createPreference FAILED', {
      orderId,
      status: e.status,
      message: e.message,
      cause: e.cause,
    });
    throw err;
  }
}

export interface BrickPaymentData {
  token: string;
  payment_method_id: string;
  installments: number;
  issuer_id?: number;
  payer: {
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    identification?: { type: string; number: string };
  };
}

export class MPPaymentError extends Error {
  status: number;
  causes: Array<{ code?: string | number; description?: string }>;
  constructor(message: string, status: number, causes: Array<{ code?: string | number; description?: string }>) {
    super(message);
    this.name = 'MPPaymentError';
    this.status = status;
    this.causes = causes;
  }
}

export async function createPayment(
  data: BrickPaymentData,
  orderId: number,
  amount: number,
  idempotencyKey: string
): Promise<{ id: string; status: string; status_detail?: string }> {
  const paymentClient = new Payment(client);
  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';

  const phone = parseArgPhone(data.payer.phone);

  try {
    const response = await paymentClient.create({
      body: {
        token: data.token,
        payment_method_id: data.payment_method_id,
        installments: data.installments,
        issuer_id: data.issuer_id,
        transaction_amount: amount,
        description: `Orden #${orderId}`,
        statement_descriptor: 'Cristal Equipamiento',
        payer: {
          email: data.payer.email,
          ...(data.payer.first_name && { first_name: data.payer.first_name }),
          ...(data.payer.last_name && { last_name: data.payer.last_name }),
          ...(phone && { phone }),
          ...(data.payer.identification && {
            identification: {
              type: data.payer.identification.type,
              number: data.payer.identification.number,
            },
          }),
        },
        external_reference: String(orderId),
        notification_url: `${backendUrl}/api/webhook/mp`,
        metadata: {
          source: APP_NAME,
          order_id: orderId,
        },
      },
      requestOptions: { idempotencyKey },
    });

    return {
      id: String(response.id!),
      status: response.status!,
      status_detail: response.status_detail,
    };
  } catch (err: unknown) {
    const e = err as {
      status?: number;
      message?: string;
      cause?: unknown;
      error?: string;
    };
    const causesRaw = Array.isArray(e.cause) ? e.cause : [];
    const causes = causesRaw.map((c: Record<string, unknown>) => ({
      code: c.code as string | number | undefined,
      description: (c.description ?? c.message) as string | undefined,
    }));
    const detail = causes.length
      ? causes.map((c) => `${c.code ?? '?'}: ${c.description ?? '?'}`).join(' | ')
      : e.message ?? 'Error desconocido';

    console.error('[MP] createPayment FAILED', {
      orderId,
      status: e.status,
      apiError: e.error,
      message: e.message,
      causes,
    });

    throw new MPPaymentError(detail, e.status ?? 400, causes);
  }
}
