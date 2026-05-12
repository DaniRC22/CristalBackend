import * as MercadoPagoReal from 'mercadopago';
import { mockMercadopagoModule } from '../lib/mercadopago-mock';

// Use mock if dummy key
const isDummyMP = !process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN.includes('dummy') || process.env.MP_ACCESS_TOKEN.length < 10;
const { MercadoPagoConfig, Preference } = isDummyMP ? mockMercadopagoModule : MercadoPagoReal;

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN!,
});

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
  customer: Customer,
  _paymentMethod: string = 'mercadopago'
): Promise<string> {
  const preference = new Preference(client);

  const response = await preference.create({
    body: {
      statement_descriptor: 'KAP Equipamiento',
      items: items.map((item) => ({
        id: String(item.id),
        title: item.name,
        description: item.name,
        quantity: item.quantity,
        unit_price: item.price,
        currency_id: 'ARS',
        picture_url: item.imageUrl,
      })),
      payer: {
        name: customer.firstName,
        surname: customer.lastName,
        email: customer.email,
        phone: { number: customer.phone },
        ...(customer.address && {
          address: {
            street_name: customer.address,
            zip_code: customer.postalCode,
          },
        }),
      },
      ...(baseUrl.startsWith('https://') && { auto_return: 'approved' }),
      back_urls: {
        success: `${baseUrl}/orden/${orderId}?status=success`,
        failure: `${baseUrl}/orden/${orderId}?status=failure`,
        pending: `${baseUrl}/orden/${orderId}?status=pending`,
      },
      external_reference: String(orderId),
      notification_url: `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/api/webhook/mp`,
    },
  });

  return response.init_point!;
}
