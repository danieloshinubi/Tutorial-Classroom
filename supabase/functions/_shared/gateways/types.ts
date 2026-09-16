// The one interface every payment provider implements. pay-init and the
// webhook talk to this, never to a provider's SDK/REST shape directly —
// adding a second real provider later means writing one file that
// satisfies this interface, touching nothing else (not the schema, not the
// admin UI, not the confirmation-queue logic).

export interface CheckoutContext {
  amount: number;
  currency: string;
  email: string;
  callbackUrl?: string;
  metadata: {
    invoiceId: string;
    invoiceReference: string;
    schoolId: string;
    schoolName?: string;
    payerId: string;
    gatewayId: string;
  };
  publicConfig: Record<string, unknown>;
  // {} in platform mode (the adapter falls back to its own env vars via
  // platformCredentials.ts) — populated from Vault in BYO mode.
  secrets: Record<string, string>;
}

export interface CheckoutResult {
  authorizationUrl: string;
  reference: string;
}

export interface WebhookEvent {
  kind: "success" | "ignored";
  reference?: string;
  amount?: number;
  feeAmount?: number;
  invoiceId?: string;
  payerId?: string;
}

export interface PaymentGatewayAdapter {
  initCheckout(ctx: CheckoutContext): Promise<CheckoutResult>;

  // Called on the raw, still-UNTRUSTED body, only to pick which school's
  // secret to verify against — never treated as fact until
  // verifyWebhookSignature() passes against that specific secret. A forged
  // payload naming someone else's gateway id still fails verification
  // against that school's real key, so this weakens nothing.
  peekGatewayId(rawBody: string): string | null;

  verifyWebhookSignature(
    rawBody: string,
    headers: Headers,
    secrets: Record<string, string>,
  ): Promise<boolean>;

  // Only ever called after verifyWebhookSignature() has passed — the body
  // is trusted by this point. Amount/feeAmount are normalised to the
  // provider's major currency unit (naira, not kobo) regardless of what
  // unit the provider's own payload uses.
  parseWebhookEvent(rawBody: string): WebhookEvent;
}
