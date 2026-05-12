export class MockMercadoPagoConfig {
  accessToken: string;

  constructor(config: { accessToken: string }) {
    this.accessToken = config.accessToken;
  }
}

export class MockPreference {
  client: any;

  constructor(client: any) {
    this.client = client;
  }

  async create(options: { body: any }) {
    const { body } = options;
    // Mock preference ID
    const mockPreferenceId = 'MOCK_' + Math.random().toString(36).substring(7);
    return {
      id: mockPreferenceId,
      init_point: `https://www.mercadopago.com/checkout/v1/redirect?pref_id=${mockPreferenceId}`,
      sandbox_init_point: `https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=${mockPreferenceId}`,
    };
  }
}

export const mockMercadopagoModule = {
  MercadoPagoConfig: MockMercadoPagoConfig,
  Preference: MockPreference,
};
