import { supabase } from "./supabaseClient";
import { db, fail } from "./db";
import { formatMoney } from "./money";

// A school paying Schoolivio for its plan (supabase/225): what it owes, and
// paying it with Paystack through the subscription-pay Edge Function. The
// price is always worked out on the server from the number of students;
// nothing here sends an amount.

export interface SubscriptionPayment {
  reference: string;
  amount: number;
  currency?: string;
  status: "pending" | "paid" | "failed" | "abandoned";
  plan: string;
  paid_at: string | null;
  period_end: string | null;
  created_at: string;
}

export interface SchoolSubscription {
  students: number;
  plan: "starter" | "growth" | "enterprise";
  plan_name: string;
  /** Monthly, in `currency`; null for Enterprise (priced directly). */
  amount: number | null;
  /** The school's own currency when Schoolivio has a price in it, else USD, else NGN (supabase/227). */
  currency: string;
  starter_price: number;
  growth_price: number;
  current_plan: string;
  trial_ends_at: string | null;
  paid_until: string | null;
  contact_email: string;
  payments: SubscriptionPayment[];
}

export const fetchSubscription = async (schoolId: string): Promise<SchoolSubscription> => {
  const { data, error } = await db.rpc("my_school_subscription", { target_school: schoolId });
  if (error) fail(error, "Could not load the school's plan.");
  return data as unknown as SchoolSubscription;
};

const invoke = async <T>(name: string, body: Record<string, unknown>, fallback: string): Promise<T> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    let detail = "";
    try {
      detail = (await (error as { context?: Response }).context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || fallback);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
};

/** Opens Paystack's checkout; it comes back to this page with ?reference=. */
export const startSubscriptionPayment = async (schoolId: string): Promise<void> => {
  const back = new URL(window.location.href);
  back.searchParams.delete("reference");
  back.searchParams.delete("trxref");
  const { authorizationUrl } = await invoke<{ authorizationUrl: string }>(
    "subscription-pay",
    { action: "start", schoolId, callbackUrl: back.toString() },
    "Could not start the payment."
  );
  window.location.assign(authorizationUrl);
};

export const verifySubscriptionPayment = (reference: string) =>
  invoke<{ status: "paid" | "pending" | "failed" | "abandoned"; period_end?: string }>(
    "subscription-pay",
    { action: "verify", reference },
    "Could not check that payment."
  );

/** The ?reference= Paystack adds on the way back, removed from the address once read. */
export const takeReturnedReference = (): string | null => {
  const url = new URL(window.location.href);
  const ref = url.searchParams.get("reference") || url.searchParams.get("trxref");
  if (!ref || !/^SCHV-[0-9A-F]{16}$/.test(ref)) return null;
  url.searchParams.delete("reference");
  url.searchParams.delete("trxref");
  window.history.replaceState(window.history.state, "", url.toString());
  return ref;
};

/** An amount in Schoolivio's price currency for this school: ₦450,000, CA$450. */
export const price = (n: number, currency: string) => formatMoney(n, currency);

export const PLAN_LABEL: Record<string, string> = {
  trial: "Free trial",
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
};
