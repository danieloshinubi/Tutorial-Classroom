// Web push on this device: whether it can, whether it is on, and turning it
// on or off. The server side is supabase/functions/push-notify, fed by the
// triggers in supabase/190_push_notifications.sql.
//
// iPhone and iPad only allow web push for a site added to the Home Screen
// (iOS 16.4 and later), opened from there. In Safari itself PushManager does
// not exist, so the page explains how to add it rather than offering a
// button that cannot work.
import { savePushSubscription, forgetMyPushSubscription } from "./api";

// Public half of the server's VAPID key pair; safe to ship in the app. The
// private half lives only in the Edge Function's secrets.
const VAPID_PUBLIC_KEY = "BKZO0bvItFd3pXXSyIB2_sOQxVYc4ZD95S12g1GmIDL5UrVcZ0rPH3fnVEaAXTlc8q0_rpHninxg__a_5DMB_nw";

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// "unsupported" | "ios-needs-home-screen" | "denied" | "default" | "granted"
export const pushState = () => {
  if (!pushSupported()) return isIOS() && !isStandalone() ? "ios-needs-home-screen" : "unsupported";
  return Notification.permission;
};

const urlBase64ToUint8Array = (base64) => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

const registration = async () => {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing || navigator.serviceWorker.register("/sw.js", { scope: "/" });
};

// Registers the worker as soon as the app loads, so it is ready (and so an
// already-granted device re-saves its subscription, which a browser can
// rotate without telling anyone).
export const startPush = async (schoolId) => {
  if (!pushSupported()) return;
  try {
    const reg = await registration();
    if (Notification.permission === "granted") {
      const sub = await reg.pushManager.getSubscription();
      if (sub) await saveSubscription(sub, schoolId);
      else await subscribe(schoolId);
    }
  } catch {
    // Push is an extra; the app works without it.
  }
};

const saveSubscription = async (sub, schoolId) => {
  const json = sub.toJSON();
  await savePushSubscription({
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    schoolId,
    userAgent: navigator.userAgent,
  });
};

const subscribe = async (schoolId) => {
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
  await saveSubscription(sub, schoolId);
  return sub;
};

// Must run from a tap or click: browsers (iPhone above all) refuse to ask
// for permission otherwise. Returns the resulting state.
export const turnOnPush = async (schoolId) => {
  if (!pushSupported()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  await subscribe(schoolId);
  return "granted";
};

export const turnOffPush = async () => {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await forgetMyPushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
};

export const isPushOnHere = async () => {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return Boolean(await reg?.pushManager.getSubscription());
};
