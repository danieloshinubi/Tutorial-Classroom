// Paystack, Flutterwave and Stripe all have working adapters. Adding a
// fourth real provider is: one new file satisfying PaymentGatewayAdapter,
// one line here, one entry in platformCredentials.ts, one webhook Edge
// Function, and one entry in PaymentGatewaySettingsPanel.jsx's provider
// list — not the schema (already ahead of this: 116_payment_gateways_
// schema.sql's check constraint already allowed all three by name before
// any of them had real code) and not the confirmation-queue logic.
//
// A provider a school picks that ISN'T here — "Other / not listed" in the
// admin UI — never actually reaches this registry: payment-gateway-connect
// runs detectProvider() (verify.ts) against the key first and only ever
// saves one of the names below, or refuses the save outright. There is no
// such thing as a payment_gateways row with an adapter-less provider.

import type { PaymentGatewayAdapter } from "./types.ts";
import { paystackAdapter } from "./paystack.ts";
import { flutterwaveAdapter } from "./flutterwave.ts";
import { stripeAdapter } from "./stripe.ts";

const ADAPTERS: Record<string, PaymentGatewayAdapter> = {
  paystack: paystackAdapter,
  flutterwave: flutterwaveAdapter,
  stripe: stripeAdapter,
};

export function getAdapter(provider: string): PaymentGatewayAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`${provider} is not available yet.`);
  return adapter;
}

export function isImplemented(provider: string): boolean {
  return provider in ADAPTERS;
}
