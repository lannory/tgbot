import { MockProvider } from './mock.js';

// Registry of payment providers by name. To add a real one, implement
// PaymentProvider (see provider.js) and register it here, e.g.:
//   if (process.env.LIQPAY_PUBLIC_KEY) providers.set('liqpay', new LiqPayProvider(...));
export function createProviders(env = process.env) {
	const providers = new Map();

	if (env.MOCK_PAYMENT_SECRET && env.NODE_ENV !== 'production') {
		providers.set('mock', new MockProvider({ secret: env.MOCK_PAYMENT_SECRET }));
	}

	return providers;
}
