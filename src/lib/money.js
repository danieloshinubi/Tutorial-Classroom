import { useMemo } from "react";

// Formats an amount in the school's own currency.
//
// This was copy-pasted in Bursary.jsx and Fees.jsx — identical but for the
// variable names — and the fee catalogue, discount editor and everything else
// in the finance work needs it too. Four copies of the same Intl call is where
// one of them quietly stops matching the others, so it lives here now.
//
// Currency comes from schools.currency (default NGN). A school never sees two
// currencies at once, so this takes the one the page already has rather than
// guessing per amount.
// narrowSymbol gives "₦45,000" rather than "NGN 45,000" — the default for NGN
// in most locales is the ISO code, which reads like an accounting export.
//
// minimumFractionDigits: 0 is the other half: school fees are whole naira, and
// a column of "₦45,000.00" is harder to scan than "₦45,000". Kobo still show
// when they exist, because maximumFractionDigits stays at 2.
// Kobo are all-or-nothing: ₦45,000 or ₦45,000.50, never ₦45,000.5. A single
// formatter cannot express that — minimumFractionDigits: 0 happily prints one
// decimal — so whole amounts and part-amounts get their own.
const options = (currency, decimals) => ({
  style: "currency",
  currency: currency || "NGN",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals,
});

// Safari and some older engines throw on currencyDisplay: "narrowSymbol"
// rather than ignoring it, which would take the whole page down over a
// currency symbol. Fall back to the default display instead.
const build = (currency, decimals) => {
  try {
    return new Intl.NumberFormat(undefined, options(currency, decimals));
  } catch {
    const { currencyDisplay, ...rest } = options(currency, decimals);
    return new Intl.NumberFormat(undefined, rest);
  }
};

// Rounded to 2dp first, so a stray float like 45000.004 counts as whole rather
// than dragging in ".00".
const pick = (whole, part) => (value) => {
  const n = Number(value || 0);
  return Math.round(n * 100) % 100 === 0 ? whole.format(n) : part.format(n);
};

export const useMoney = (currency) =>
  useMemo(() => pick(build(currency, 0), build(currency, 2)), [currency]);

// The same thing outside a component — a CSV export, a total built in a
// handler. Same formatting, no hook rules.
export const formatMoney = (value, currency) =>
  pick(build(currency, 0), build(currency, 2))(value);
