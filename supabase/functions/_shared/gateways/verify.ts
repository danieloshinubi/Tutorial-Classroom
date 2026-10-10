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
// secret_key for every provider so far; Sznd's probe additionally needs
// api_key, which is why this is the whole BYO secrets blob rather than a
// single string — see probeSznd below.
type Secrets = Record<string, string>;

const probePaystack = async (secrets: Secrets): Promise<ProbeResult> => {
  const res = await fetch("https://api.paystack.co/transaction/totals", {
    headers: { Authorization: `Bearer ${secrets.secret_key}` },
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, message: body?.message };
};

const probeFlutterwave = async (secrets: Secrets): Promise<ProbeResult> => {
  const res = await fetch("https://api.flutterwave.com/v3/balances", {
    headers: { Authorization: `Bearer ${secrets.secret_key}` },
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, message: body?.message };
};

const probeStripe = async (secrets: Secrets): Promise<ProbeResult> => {
  const res = await fetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${secrets.secret_key}` },
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, message: body?.error?.message };
};

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// Sznd signs every /client request, including this read-only probe — see
// _shared/gateways/sznd.ts for why the signature is body + "|" + timestamp.
const probeSznd = async (secrets: Secrets): Promise<ProbeResult> => {
  if (!secrets.api_key) return { ok: false, message: "Enter the API key too." };
  const timestamp = new Date().toISOString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secrets.secret_key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`|${timestamp}`)));
  const szndBaseUrl = Deno.env.get("SZND_BASE_URL") || "https://transfaar-test-a8d2cb980af2.herokuapp.com";
  const res = await fetch(`${szndBaseUrl}/api/v1/client/currencies`, {
    headers: {
      "X-Api-Key": secrets.api_key,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    },
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, message: body?.message };
};

const PROBES: Record<string, (secrets: Secrets) => Promise<ProbeResult>> = {
  paystack: probePaystack,
  flutterwave: probeFlutterwave,
  stripe: probeStripe,
  sznd: probeSznd,
};

// Confirms a key against the specific provider the admin picked.
export async function verifyCredentials(
  provider: string,
  secrets: Secrets,
): Promise<ProbeResult> {
  const probe = PROBES[provider];
  if (!probe) return { ok: false, message: `${provider} isn't available yet.` };
  try {
    return await probe(secrets);
  } catch (err) {
    return { ok: false, message: (err as Error).message || "Could not reach that gateway to check the key." };
  }
}

// For "Other / not listed": which of our real providers, if any, does this
// secret key actually belong to? Flutterwave's own key format is
// unambiguous (FLWSECK...); Paystack and Stripe both hand out sk_test_/
// sk_live_-shaped keys, so those two are told apart by which one's API
// actually accepts the key, not by guessing from the string. Sznd is never
// auto-detected this way — its probe needs api_key alongside secret_key,
// which "Other / not listed" (a single pasted key) never collects.
export async function detectProvider(secretKey: string): Promise<string | null> {
  const order = secretKey.startsWith("FLWSECK")
    ? ["flutterwave", "paystack", "stripe"]
    : ["paystack", "stripe", "flutterwave"];

  for (const provider of order) {
    const result = await PROBES[provider]({ secret_key: secretKey });
    if (result.ok) return provider;
  }
  return null;
}
