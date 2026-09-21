export function openPaystackPayment(authorizationUrl) {
  if (!authorizationUrl) {
    throw new Error("Payment gateway did not return a checkout URL — please try again.");
  }
  window.location.href = authorizationUrl;
}
