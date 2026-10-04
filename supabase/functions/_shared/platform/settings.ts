// Schoolivio's own sender and Paystack account (supabase/225), entered on
// Console → Settings. The SMTP password and the Paystack secret key live in
// Vault and are read here with the service role only, never sent to a
// browser. Paystack falls back to the PAYSTACK_SECRET_KEY Edge Function
// variable (the shared account schools can use for fees) until a key is
// saved in Settings.
import nodemailer from "npm:nodemailer@10.0.9";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export interface PlatformMailSettings {
  sender_address: string | null;
  sender_name: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: "ssl" | "starttls" | "none" | null;
  smtp_username: string | null;
  contact_email: string;
  paystack_public_key: string | null;
}

export async function platformSettings(admin: AdminClient): Promise<PlatformMailSettings> {
  const { data, error } = await admin.rpc("platform_mail_settings");
  if (error || !data) throw new Error(error?.message || "Schoolivio settings are missing.");
  return data as PlatformMailSettings;
}

export async function platformSecret(admin: AdminClient, which: "smtp" | "paystack"): Promise<string | null> {
  const { data } = await admin.rpc("platform_get_secret", { which });
  if (data) return String(data);
  return which === "paystack" ? Deno.env.get("PAYSTACK_SECRET_KEY") || null : null;
}

/** A nodemailer transport from Schoolivio's sender, or null when it is not set up yet. */
export async function platformTransport(admin: AdminClient, s: PlatformMailSettings) {
  if (!s.sender_address || !s.smtp_host || !s.smtp_username) return null;
  const password = await platformSecret(admin, "smtp");
  if (!password) return null;
  const transport = nodemailer.createTransport({
    host: s.smtp_host,
    port: s.smtp_port || 587,
    secure: s.smtp_security === "ssl",
    requireTLS: s.smtp_security === "starttls",
    auth: { user: s.smtp_username, pass: password },
  });
  return { transport, from: `"${s.sender_name.replace(/"/g, "")}" <${s.sender_address}>` };
}
