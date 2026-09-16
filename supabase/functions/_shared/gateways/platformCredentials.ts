// Platform-mode secrets — Schoolivio's own shared account, set once as an
// Edge Function env var per provider (never per-school, never in the
// browser). BYO-mode secrets instead come from Vault via
// classroom.get_gateway_secret() — see pay-init/paystack-webhook.

const ENV_VAR_BY_PROVIDER: Record<string, string> = {
  paystack: "PAYSTACK_SECRET_KEY",
};

export function resolvePlatformSecrets(provider: string): Record<string, string> {
  const envVar = ENV_VAR_BY_PROVIDER[provider];
  const value = envVar ? Deno.env.get(envVar) : undefined;
  if (!value) return {};
  return { secret_key: value };
}
