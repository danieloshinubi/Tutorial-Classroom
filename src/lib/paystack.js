// Paystack's checkout.paystack.com embeds standard.paystack.co in an iframe,
// but standard.paystack.co sets X-Frame-Options: sameorigin which blocks it.
// Navigating directly to standard.paystack.co/<access_code> loads it as the
// top-level page — no iframe, no block.
//
// The access code is the last path segment of the authorizationUrl that
// pay-init returns (https://checkout.paystack.com/ACCESS_CODE).
export function openPaystackPayment(authorizationUrl) {
  const accessCode = authorizationUrl.split("/").pop();
  window.location.href = `https://standard.paystack.co/${accessCode}`;
}
