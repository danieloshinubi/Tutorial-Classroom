// Sznd payout primitives — beneficiaries, withdrawal quotes, and accepting
// one to actually move money. Used by payroll-payout-sznd/index.ts.
//
// UNVERIFIED against Sznd's live API as of 2026-10-12 — unlike
// checkout/initialize and payment/verify in sznd.ts (both confirmed live,
// repeatedly, against real staging transactions), nothing here has been
// test-run yet: the staging business account used so far has no beneficiary
// or payout permission tested. Field names below follow Sznd's documented
// shape (docs.sznd.app/customers/beneficiaries) plus the nested-under-`data`
// response convention checkout/initialize turned out to actually use — but
// that convention is confirmed for ONE endpoint, not assumed safe here.
// Before any real payout runs, re-verify this file the same way sznd.ts's
// checkout path was verified: real staging call, read the actual response
// shape, fix whatever's wrong.

import { SZND_BASE_URL, signedHeaders } from "./sznd.ts";

type SzndSecrets = { api_key: string; secret_key: string };

const sznd = async (secrets: SzndSecrets, method: string, path: string, body?: unknown) => {
  const bodyStr = body !== undefined ? JSON.stringify(body) : "";
  const headers = await signedHeaders(secrets.api_key, secrets.secret_key, bodyStr);
  const res = await fetch(`${SZND_BASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: bodyStr } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.message || json?.error || `Sznd ${method} ${path} failed with HTTP ${res.status}`;
    throw new Error(message);
  }
  return json;
};

export type BeneficiaryDetails = {
  fullName: string;
  bankName: string;
  accountNumber: string;
  accountName?: string | null;
  email?: string | null;
};

// Creates a new NGN individual beneficiary. bank_code is recommended by
// Sznd's docs but not required for NGN — this codebase has no bank-code
// lookup wired up (Payroll.jsx's bank field is free text), so it's omitted
// rather than guessed.
export async function createBeneficiary(
  secrets: SzndSecrets,
  details: BeneficiaryDetails,
): Promise<string> {
  const names = details.fullName.trim().split(/\s+/);
  const firstName = names[0] || "Staff";
  const lastName = names.slice(1).join(" ") || "Member";

  const result = await sznd(secrets, "POST", "/api/v1/client/beneficiaries", {
    first_name: firstName,
    last_name: lastName,
    account_name: details.accountName || details.fullName,
    bank_name: details.bankName,
    account_number: details.accountNumber,
    country_code: "NG",
    currency_code: "NGN",
    email: details.email || undefined,
  });

  const beneficiaryId = result?.id || result?.data?.id;
  if (!beneficiaryId) throw new Error("Sznd did not return a beneficiary id");
  return beneficiaryId;
}

// Withdrawal quote + accept, in one call — a quote has to be accepted
// within its validity window, and nothing in this codebase holds a quote
// open for later, so there is no reason to split these into two exported
// functions the caller has to remember to chain correctly.
export async function payOutToBeneficiary(
  secrets: SzndSecrets,
  params: { beneficiaryId: string; amount: number; narration: string; reference: string },
): Promise<{ transactionId: string | null; transactionReference: string | null }> {
  const quote = await sznd(secrets, "POST", "/api/v1/client/quotes", {
    source_currency: "NGN",
    target_currency: "NGN",
    source_amount: params.amount.toFixed(2),
    quote_type: "WITHDRAWAL",
    beneficiary_id: params.beneficiaryId,
    narration: params.narration,
    origin_reference: params.reference,
  });
  const quoteId = quote?.id || quote?.quote_id || quote?.data?.id || quote?.data?.quote_id;
  if (!quoteId) throw new Error("Sznd did not return a quote id");

  const accepted = await sznd(secrets, "POST", `/api/v1/client/quotes/${quoteId}/accept`, {});
  return {
    transactionId: accepted?.transaction_id ?? accepted?.data?.transaction_id ?? null,
    transactionReference: accepted?.transaction_reference ?? accepted?.data?.transaction_reference ?? null,
  };
}
