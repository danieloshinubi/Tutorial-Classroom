// Documents a family attaches on the public Apply form, before an
// application exists (supabase/274). The form used to write straight into
// storage, which meant storage had to let anyone without an account read and
// delete "unsent" files. Now this function stores the file and gives the
// family a private token for it; only that token removes it, and only files
// stored here can be attached when the application is submitted.
//
//   POST multipart/form-data  schoolId, kind, file  -> { path, token, name, size, mime_type, kind }
//   POST application/json     { action: "remove", path, token } -> { ok: true }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const BUCKET = "course-materials";
const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
const KINDS = ["birth_certificate", "previous_results", "passport", "transfer_certificate", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));

// Constant-time, so a token can't be guessed a character at a time.
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// The visitor's address, hashed, for the upload limit (never stored as-is).
const visitorKey = async (req: Request) => {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  return `upload:${(await sha256(`schoolivio-upload:${ip}`)).slice(0, 24)}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "classroom" },
  });

  try {
    const type = req.headers.get("content-type") || "";

    /* --------------------------------------------------------- remove */
    if (type.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      if (body.action !== "remove") return json({ error: "Unknown request." }, 400);
      const path = String(body.path || "");
      const token = String(body.token || "");
      if (!path || !token) return json({ error: "Which file?" }, 400);
      const { data: row } = await admin.from("applicant_uploads").select("path, token_hash").eq("path", path).maybeSingle();
      // Already claimed by a submitted application, or not ours: nothing to do.
      if (!row || !same(row.token_hash, await sha256(token))) return json({ ok: true });
      await admin.storage.from(BUCKET).remove([path]);
      await admin.from("applicant_uploads").delete().eq("path", path);
      return json({ ok: true });
    }

    /* --------------------------------------------------------- upload */
    const form = await req.formData().catch(() => null);
    if (!form) return json({ error: "Send the file as a form upload." }, 400);
    const schoolId = String(form.get("schoolId") || "");
    const kind = KINDS.includes(String(form.get("kind"))) ? String(form.get("kind")) : "other";
    const file = form.get("file");
    if (!UUID.test(schoolId)) return json({ error: "Unknown school." }, 400);
    if (!(file instanceof File)) return json({ error: "Choose a file." }, 400);
    if (!TYPES.includes(file.type)) return json({ error: "That file type isn't supported. Use PDF, JPEG, PNG, WEBP or HEIC." }, 400);
    if (file.size <= 0 || file.size > MAX_BYTES) return json({ error: "That file is over 15 MB." }, 400);

    const { data: active } = await admin.rpc("is_active_school", { target_school: schoolId });
    if (!active) return json({ error: "This school is not taking applications here." }, 400);

    // 30 files an hour per visitor, 500 a day per school: enough for any
    // family, not enough to fill a school's storage.
    const { data: allowed } = await admin.rpc("ai_rate_ok", {
      target_school: schoolId,
      who_in: await visitorKey(req),
      per_hour: 30,
      per_school_day: 500,
    });
    if (allowed === false) return json({ error: "Too many uploads. Please wait a little and try again." }, 429);

    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "document";
    const path = `admissions/${schoolId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upError } = await admin.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (upError) return json({ error: "Could not store that file. Please try again." }, 500);

    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const { error: rowError } = await admin.from("applicant_uploads").insert({
      path,
      school_id: schoolId,
      token_hash: await sha256(token),
    });
    if (rowError) {
      await admin.storage.from(BUCKET).remove([path]);
      return json({ error: "Could not store that file. Please try again." }, 500);
    }

    return json({ path, token, name: file.name, size: file.size, mime_type: file.type, kind });
  } catch (_err) {
    return json({ error: "Could not store that file. Please try again." }, 500);
  }
});
