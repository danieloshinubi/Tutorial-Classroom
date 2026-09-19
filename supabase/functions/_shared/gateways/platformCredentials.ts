// Platform-mode secrets — Schoolivio's own shared account, set once as
// Edge Function env vars per provider (never per-school, never in the
// browser). BYO-mode secrets instead come from Vault via
// classroom.get_gateway_secret() — see pay-init/paystack-webhook.
//
// A provider needs more than one env var here exactly when its BYO
// credential form does (PaymentGatewaySettingsPanel.jsx): Flutterwave's
// webhook has no derivable signature (see flutterwave.ts), so its
// dashboard-configured "secret hash" needs its own var; Stripe's webhook
// signing secret is likewise a separate credential from its API secret key.
const ENV_VARS_BY_PROVIDER: Record<string, Record<string, string>> = {
  paystack: { secret_key: "PAYSTACK_SECRET_KEY" },
  flutterwave: { secret_key: "FLUTTERWAVE_SECRET_KEY", hash: "FLUTTERWAVE_SECRET_HASH" },
  stripe: { secret_key: "STRIPE_SECRET_KEY", webhook_secret: "STRIPE_WEBHOOK_SECRET" },
};

export function resolvePlatformSecrets(provider: string): Record<string, string> {
  const fields = ENV_VARS_BY_PROVIDER[provider];
  if (!fields) return {};
  const out: Record<string, string> = {};
  for (const [field, envVar] of Object.entries(fields)) {
    const value = Deno.env.get(envVar);
    if (value) out[field] = value;
  }
  return out;
}
