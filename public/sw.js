/* Schoolivio's service worker: shows push notifications, and opens the right
   page when one is tapped. It runs in the background even when the app is
   closed, which is what lets a chat message reach a phone straight away.

   The server (supabase/functions/push-notify) sends { title, body, url, tag,
   icon }. tag groups a conversation: a new message in the same chat replaces
   its notification (and still buzzes, renotify) instead of stacking. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: "Schoolivio", body: event.data ? event.data.text() : "" };
  }
  const url = new URL(data.url || "/", self.location.origin);

  event.waitUntil(
    (async () => {
      // Like WhatsApp: if you are already looking at that chat, no banner.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const watching = windows.some(
        (w) => w.visibilityState === "visible" && w.focused !== false && new URL(w.url).pathname === url.pathname
      );
      if (watching) return;

      await self.registration.showNotification(data.title || "Schoolivio", {
        body: data.body || "",
        icon: data.icon || "/brand/favicon.png",
        badge: "/brand/favicon.png",
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        timestamp: Date.now(),
        data: { url: url.href },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || self.location.origin;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open Schoolivio window: bring it forward and go to the page.
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ("navigate" in open) return open.navigate(target);
        return undefined;
      }
      return self.clients.openWindow(target);
    })()
  );
});
