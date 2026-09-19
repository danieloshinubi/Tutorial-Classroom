// Confirms a secret key actually authenticates with a provider, and — for
// "I don't know which gateway this is" — figures out which provider it
// belongs to in the first place.
//
// Each check is a cheap, read-only, side-effect-free API call that only
// succeeds if the key is genuine: Paystack/Flutterwave/Stripe all expose a
// "read this account's own balance/totals" endpoint gated on the secret key
// having real API access, which is exactly the property worth checking
// before a school starts sending real families to a checkout page built on
// it. This is what turns "saved" into "confirmed to actually work" —
// before this, a mistyped or revoked key only surfaced the first time a
// real payment tried to go through it.

type ProbeResult = { ok: boolean; message?: string };

const probePaystack = async (secretKey: string): Promise<ProbeResult> => {
  const res = await fetch("https://api.paystack.co/transaction/totals", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, message: body?.message };
};

const probeFlutterwave = async (secretKey: string): Promise<ProbeResult> => {
  const res = await fetch("https://api.flutterwave.com/v3/balances", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, message: body?.message };
};

const probeStripe = async (secretKey: string): Promise<ProbeResult> => {
  const res = await fetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, message: body?.error?.message };
};

const PROBES: Record<string, (secretKey: string) => Promise<ProbeResult>> = {
  paystack: probePaystack,
  flutterwave: probeFlutterwave,
  stripe: probeStripe,
};

// Confirms a key against the specific provider the admin picked.
export async function verifyCredentials(
  provider: string,
  secretKey: string,
): Promise<ProbeResult> {
  const probe = PROBES[provider];
  if (!probe) return { ok: false, message: `${provider} isn't available yet.` };
  try {
    return await probe(secretKey);
  } catch (err) {
    return { ok: false, message: (err as Error).message || "Could not reach that gateway to check the key." };
  }
}

// For "Other / not listed": which of our real providers, if any, does this
// secret key actually belong to? Flutterwave's own key format is
// unambiguous (FLWSECK...); Paystack and Stripe both hand out sk_test_/
// sk_live_-shaped keys, so those two are told apart by which one's API
// actually accepts the key, not by guessing from the string.
export async function detectProvider(secretKey: string): Promise<string | null> {
  const order = secretKey.startsWith("FLWSECK")
    ? ["flutterwave", "paystack", "stripe"]
    : ["paystack", "stripe", "flutterwave"];

  for (const provider of order) {
    const result = await PROBES[provider](secretKey);
    if (result.ok) return provider;
  }
  return null;
}
