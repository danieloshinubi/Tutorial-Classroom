// Loads Paystack's inline popup script on demand (not in the initial bundle —
// most users never reach a payment screen). Returns a promise that resolves
// once window.PaystackPop is available.
let loading = null;

export function loadPaystackScript() {
  if (window.PaystackPop) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.paystack.co/v2/inline.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load Paystack — check your internet connection."));
    document.head.appendChild(s);
  });
  return loading;
}

// Opens the Paystack inline popup for a transaction that was already
// initialised server-side. `authorizationUrl` is the checkout.paystack.com
// URL returned by pay-init; we pull the access code from its path.
// Returns a promise: resolves with the Paystack transaction object on success,
// rejects (with no message) when the user cancels.
export function openPaystackPopup(authorizationUrl) {
  return loadPaystackScript().then(
    () =>
      new Promise((resolve, reject) => {
        const accessCode = authorizationUrl.split("/").pop();
        const popup = new window.PaystackPop();
        popup.resumeTransaction(accessCode, {
          onSuccess: resolve,
          onCancel: () => reject(new Error("cancelled")),
        });
      })
  );
}
