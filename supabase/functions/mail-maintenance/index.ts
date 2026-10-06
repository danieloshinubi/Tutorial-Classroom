// Mail housekeeping, once a day by the scheduler (supabase/243): Deleted and
// Junk emptied by each school's number of days, then the files nothing
// refers to any more (and uploads left by stopped imports) removed from
// storage. Shared cron secret only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sameSecret = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

Deno.serve(async (req) => {
  const secret = Deno.env.get("TICKET_MAIL_CRON_SECRET") ?? "";
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", secret)) return json({ error: "Not authorized" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "classroom" } });
  const { data, error } = await admin.rpc("mail_retention_run");
  if (error) return json({ error: error.message }, 500);
  const r = data as { messages_removed: number; files: string[]; uploads: string[] };
  let removed = 0;
  for (const [bucket, paths] of [["mail", r.files ?? []], ["mail-imports", r.uploads ?? []]] as const) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error: e } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (e) console.error("mail-maintenance remove", bucket, e.message);
      else removed += Math.min(100, paths.length - i);
    }
  }
  return json({ messages_removed: r.messages_removed, files_removed: removed });
});
