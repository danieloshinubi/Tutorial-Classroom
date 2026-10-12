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
    // "self" — Schoolivio's own business account, not a sub-customer. Every
    // documented example sends this; omitting it was an early mistake,
    // caught before any live call was made.
    user_id: "self",
    first_name: firstName,
    last_name: lastName,
    account_name: details.accountName || details.fullName,
    bank_name: details.bankName,
    account_number: details.accountNumber,
    country_code: "NG",
    currency_code: "NGN",
    recipient_type: "individual",
    email: details.email || undefined,
  });

  const beneficiaryId = result?.id || result?.data?.id;
  if (!beneficiaryId) throw new Error("Sznd did not return a beneficiary id");
  return beneficiaryId;
}

// Confirmed live 2026-10-12: a WITHDRAWAL quote carries real fees on top of
// the amount a beneficiary receives — a ₦5,000 test quote's total_payable
// was ₦5,120 (₦100 payout fee + ₦20 processing fee). classroom.
// sznd_school_balance() only knows about payroll_payouts.amount (the net
// pay, not the fee), so the balance it reports is an UNDER-estimate of what
// actually gets debited — exactly backwards from the direction that would
// be safe to ignore. payroll-payout-sznd/index.ts re-checks the balance
// against this quote's real total_payable before ever accepting it; see
// that file for the enforcement, this function only reports the number.
export async function createWithdrawalQuote(
  secrets: SzndSecrets,
  params: { beneficiaryId: string; amount: number; narration: string; reference: string },
): Promise<{ quoteId: string; totalPayable: number }> {
  // origin_reference is capped at 40 chars per Sznd's own docs (even
  // tighter than checkout/initialize's 50 — see sznd.ts's STATUS comment
  // for how that one was found the hard way). "szp" + a bare UUID is 39,
  // which fits with one char to spare — do not lengthen this prefix.
  const quote = await sznd(secrets, "POST", "/api/v1/client/quotes", {
    source_currency: "NGN",
    target_currency: "NGN",
    source_amount: params.amount.toFixed(2),
    quote_type: "WITHDRAWAL",
    beneficiary_id: params.beneficiaryId,
    on_behalf_of: "self",
    narration: params.narration,
    origin_reference: params.reference,
    tz: "Africa/Lagos",
  });
  const quoteId = quote?.quote_id || quote?.id || quote?.data?.quote_id || quote?.data?.id;
  if (!quoteId) throw new Error("Sznd did not return a quote id");
  const totalPayable = Number(quote?.total_payable ?? quote?.data?.total_payable ?? params.amount);
  return { quoteId, totalPayable };
}

export async function acceptQuote(
  secrets: SzndSecrets,
  quoteId: string,
): Promise<{ transactionId: string | null; transactionReference: string | null }> {
  const accepted = await sznd(secrets, "POST", `/api/v1/client/quotes/${quoteId}/accept`, {});
  return {
    transactionId: accepted?.transaction_id ?? accepted?.data?.transaction_id ?? null,
    transactionReference: accepted?.transaction_reference ?? accepted?.data?.transaction_reference ?? null,
  };
}
