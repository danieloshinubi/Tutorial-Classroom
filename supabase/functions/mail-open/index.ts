// The tiny picture in outside mail sent with "Tell me when it's opened"
// (supabase/241). When the recipient's mail app shows it, the sender is told
// at once (mail_open_picture → a notification, live and pushed to the phone).
// Always answers with the same transparent 1×1 GIF, whatever the token, so it
// says nothing to anyone probing it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const picture = () =>
  new Response(GIF, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (UUID.test(token)) {
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "classroom" } });
      await admin.rpc("mail_open_picture", { token_in: token });
    } catch (err) {
      console.error("mail-open", (err as Error).message);
    }
  }
  return picture();
});
