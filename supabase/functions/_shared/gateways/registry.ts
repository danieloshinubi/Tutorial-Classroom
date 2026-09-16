// Only Paystack has a working adapter today. 'flutterwave'/'stripe' are
// valid values in classroom.payment_gateways.provider (the schema is ready
// for them) but absent here — the frontend's own provider picker only ever
// offers implemented providers (IMPLEMENTED_PROVIDERS in
// PaymentGatewaySettingsPanel.jsx), so reaching this throw at all would mean
// a row was created some other way. Adding a second real provider is: one
// new file satisfying PaymentGatewayAdapter, one line here, nothing else —
// not the schema, not the admin UI, not the confirmation-queue logic.

import type { PaymentGatewayAdapter } from "./types.ts";
import { paystackAdapter } from "./paystack.ts";

const ADAPTERS: Record<string, PaymentGatewayAdapter> = {
  paystack: paystackAdapter,
};

export function getAdapter(provider: string): PaymentGatewayAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`${provider} is not available yet.`);
  return adapter;
}

export function isImplemented(provider: string): boolean {
  return provider in ADAPTERS;
}
