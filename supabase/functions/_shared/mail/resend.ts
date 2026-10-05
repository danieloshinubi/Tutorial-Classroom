// Talking to a school's own Resend account (Schoolivio Mail, supabase/236):
// one small fetch wrapper that turns Resend's errors into plain sentences,
// and the check that a delivery report really came from Resend.

const API = "https://api.resend.com";

export interface ResendResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Resend's error name, e.g. "validation_error", "restricted_api_key". */
  code: string | null;
  message: string | null;
}

export async function resend<T = Record<string, unknown>>(
  key: string,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<ResendResult<T>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    return { ok: false, status: 0, data: null, code: "network", message: `Could not reach Resend: ${(err as Error).message}` };
  }
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (res.ok) return { ok: true, status: res.status, data: parsed as T, code: null, message: null };
  return {
    ok: false,
    status: res.status,
    data: null,
    code: (parsed?.name as string) ?? null,
    message: (parsed?.message as string) ?? (text || res.statusText),
  };
}

/** A sentence a school admin can act on, for a key Resend turned down. */
export function keyProblem(r: ResendResult<unknown>): string {
  if (r.code === "restricted_api_key") {
    return "That key can only send. In Resend, create a key with Full access (API Keys → Create API key → Permission: Full access) and paste that one.";
  }
  if (r.status === 401 || r.status === 403 || r.code === "invalid_api_key" || r.code === "missing_api_key") {
    return "Resend did not accept that key. Copy it again from Resend (API Keys) and paste the whole key, starting re_.";
  }
  return r.message || "Resend did not answer. Try again in a minute.";
}

// --- Delivery reports are signed the Svix way: HMAC-SHA256 over
// "<svix-id>.<svix-timestamp>.<raw body>" with the base64 part of the
// signing secret (after "whsec_"); svix-signature holds one or more
// "v1,<base64>" separated by spaces. Older than five minutes is refused.
const b64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const sameText = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export async function verifySignature(secret: string, headers: Headers, rawBody: string): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const keyBytes = unb64(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)));
  return signatures.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && !!sig && sameText(sig, expected);
  });
}

/** What the school's webhook listens for: delivery reports, and received mail (supabase/238). */
export const REPORT_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
  "email.received",
];

// --- A school's domain as Resend describes it, and what that means here.
export interface ResendRecord {
  record?: string;
  type?: string;
  name?: string;
  value?: string;
  priority?: number;
  status?: string;
  ttl?: string | number;
}
export interface ResendDomain {
  id: string;
  name: string;
  status: string;
  region?: string;
  records?: ResendRecord[];
  capabilities?: { sending?: string; receiving?: string };
}

export const records = (d: ResendDomain | null) =>
  (d?.records ?? []).map((r) => ({
    record: r.record ?? "",
    type: r.type ?? "",
    name: r.name ?? "",
    value: r.value ?? "",
    priority: r.priority ?? null,
    status: r.status ?? "not_started",
    ttl: r.ttl ?? "Auto",
  }));

// The receiving MX record (supabase/238) is the one MX record not on the
// "send" return-path name, which carries sending's own MX.
export const isReceiving = (r: ResendRecord) =>
  (r.record ?? "").toLowerCase().includes("receiv") || (r.type === "MX" && !/^send(\.|$)/i.test(r.name ?? ""));

// Sending counts as verified once its own records are found, whatever the
// receiving MX record is doing: a school that turns receiving on before its
// switch day must not lose outside sending meanwhile.
export function statuses(d: ResendDomain | null) {
  const all = d?.records ?? [];
  const sendingRecords = all.filter((r) => !isReceiving(r));
  const receivingRecord = all.find(isReceiving);
  const sending = sendingRecords.length && sendingRecords.every((r) => r.status === "verified")
    ? "verified"
    : d?.status === "verified" ? "verified" : d?.status === "partially_verified" ? "pending" : d?.status ?? "not_started";
  return {
    sending,
    receivingOn: d?.capabilities?.receiving === "enabled",
    receiving: receivingRecord?.status ?? "not_started",
  };
}

