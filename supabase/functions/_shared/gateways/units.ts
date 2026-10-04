// Gateways take amounts in a currency's smallest unit: 100 kobo to the
// naira, 100 cents to the dollar. A few currencies have no smaller unit, so
// an amount in yen, francs CFA or Ugandan shillings is sent as it is (Stripe's
// list). Schools can now use any currency (supabase/226), so this matters.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export const toMinorUnits = (amount: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);

export const fromMinorUnits = (amount: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? amount : amount / 100;

// What Paystack accepts (paystack.com/docs/api/#supported-currency). A
// school billing in anything else needs Flutterwave or Stripe.
export const PAYSTACK_CURRENCIES = new Set(["NGN", "GHS", "ZAR", "KES", "USD", "XOF", "EGP", "RWF"]);
