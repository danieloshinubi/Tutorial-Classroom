// Moves audit log entries older than 12 months out of the database into
// private file storage (bucket audit-archive), once a month by pg_cron
// (supabase/218). Each batch is written to storage first, one file per school,
// and only then removed from the table, so an entry is never lost: if an
// upload fails, its rows simply stay until the next run.
//
// Called by the scheduler only, with the same shared secret ticket-mail-poll
// checks, compared in constant time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differences === 0;
};

const BATCH = 5000;
const RUN_BUDGET_MS = 100_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const cronSecret = Deno.env.get("TICKET_MAIL_CRON_SECRET");
  if (!cronSecret) return json({ error: "Not configured" }, 503);
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", cronSecret)) return json({ error: "Not authorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "classroom" },
  });

  const startedAt = Date.now();
  let archived = 0;
  let files = 0;

  while (Date.now() - startedAt < RUN_BUDGET_MS) {
    const { data: rows, error } = await admin.rpc("audit_archive_take", { batch_size: BATCH });
    if (error) return json({ error: error.message, archived, files }, 500);
    if (!rows?.length) break;

    // One file per school in this batch, named so it never overwrites another.
    // deno-lint-ignore no-explicit-any
    const bySchool = new Map<string, any[]>();
    for (const row of rows) {
      const key = row.school_id || "no-school";
      if (!bySchool.has(key)) bySchool.set(key, []);
      bySchool.get(key)!.push(row);
    }

    const saved: string[] = [];
    for (const [school, list] of bySchool) {
      const first = list[0];
      const month = String(first.created_at).slice(0, 7);
      const path = `${school}/${month}/${String(first.created_at).replace(/[:.]/g, "-")}-${first.id}.json`;
      const { error: uploadError } = await admin.storage
        .from("audit-archive")
        .upload(path, new Blob([JSON.stringify(list)], { type: "application/json" }), { upsert: true });
      if (uploadError) {
        console.error(`Could not archive ${list.length} entries for ${school}: ${uploadError.message}`);
        continue;
      }
      files += 1;
      for (const row of list) saved.push(row.id);
    }

    if (!saved.length) break;
    const { data: removed, error: removeError } = await admin.rpc("audit_archive_remove", { archived_ids: saved });
    if (removeError) return json({ error: removeError.message, archived, files }, 500);
    archived += removed || 0;
    if (rows.length < BATCH) break;
  }

  return json({ archived, files });
});
