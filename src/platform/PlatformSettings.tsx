import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { db } from "../lib/db";
import { Page, Card, Button, Badge, Field, Select, SkeletonText } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";

// Console → Settings (supabase/225): Schoolivio's own email sender, which
// sends schools their trial and renewal reminders, and Schoolivio's Paystack
// account, which schools pay their plan into. The SMTP password and the
// Paystack secret key are typed here, sent once to the platform-settings
// Edge Function and kept in Vault; nobody can read them back, so the fields
// stay empty and only say whether one is saved.

interface Settings {
  sender_address: string | null;
  sender_name: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: "ssl" | "starttls" | "none" | null;
  smtp_username: string | null;
  smtp_connected: boolean;
  paystack_public_key: string | null;
  paystack_connected: boolean;
  contact_email: string;
}

const SECURITY = [
  { value: "ssl", label: "SSL/TLS (usually port 465)" },
  { value: "starttls", label: "STARTTLS (usually port 587)" },
  { value: "none", label: "None" },
];

const callSettings = async (body: Record<string, unknown>) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");
  const { data, error } = await supabase.functions.invoke("platform-settings", {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    let detail = "";
    try {
      detail = (await (error as { context?: Response }).context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || "Could not save that.");
  }
  if (data?.error) throw new Error(data.error);
  return data as { ok: true; sentTo?: string };
};

const PlatformSettings = () => {
  const { setError, setNotice } = useActionFeedback();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState({
    sender_address: "",
    sender_name: "Schoolivio",
    smtp_host: "",
    smtp_port: "",
    smtp_security: "ssl",
    smtp_username: "",
    contact_email: "",
    paystack_public_key: "",
  });
  const [smtpPassword, setSmtpPassword] = useState("");
  const [paystackSecret, setPaystackSecret] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test">("");

  const load = useCallback(async () => {
    const { data, error } = await db.rpc("platform_settings_view");
    if (error) return setError(error.message);
    const s = data as unknown as Settings;
    setSaved(s);
    setForm({
      sender_address: s.sender_address || "",
      sender_name: s.sender_name || "Schoolivio",
      smtp_host: s.smtp_host || "",
      smtp_port: s.smtp_port ? String(s.smtp_port) : "",
      smtp_security: s.smtp_security || "ssl",
      smtp_username: s.smtp_username || "",
      contact_email: s.contact_email || "",
      paystack_public_key: s.paystack_public_key || "",
    });
  }, [setError]);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message || "Could not load settings."));
  }, [load, setError]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save");
    try {
      await callSettings({ settings: form, smtpPassword: smtpPassword || undefined, paystackSecret: paystackSecret || undefined });
      setSmtpPassword("");
      setPaystackSecret("");
      setNotice("Settings saved.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const r = await callSettings({ action: "test" });
      setNotice(`Test email sent to ${r.sentTo}. Check that inbox (and spam).`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (!saved) {
    return (
      <Page title="Settings">
        <Card>
          <SkeletonText lines={6} />
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Settings" subtitle="Schoolivio's own email sender and Paystack account">
      <form onSubmit={save} className="platform-settings">
        <Card>
          <div className="plan-pay-head">
            <h3 style={{ margin: 0 }}>{"Email sender"}</h3>
            <Badge tone={saved.smtp_connected ? "success" : "warn"}>{saved.smtp_connected ? "Connected" : "Not set up"}</Badge>
          </div>
          <p className="plan-pay-note">
            {"Trial and renewal reminders go to each school's owners and admins from this address, 5, 3 and 1 day(s) before and on the day."}
          </p>
          <div className="team-name-row">
            <Field label="Send from (address)">
              <input className="input" type="email" placeholder="info@tekktopia.com" value={form.sender_address} onChange={set("sender_address")} />
            </Field>
            <Field label="Sender name">
              <input className="input" maxLength={80} value={form.sender_name} onChange={set("sender_name")} />
            </Field>
          </div>
          <div className="team-name-row">
            <Field label="SMTP server" hint="From your email provider, e.g. smtp.gmail.com or mail.tekktopia.com">
              <input className="input" value={form.smtp_host} onChange={set("smtp_host")} />
            </Field>
            <Field label="Port">
              <input className="input" inputMode="numeric" placeholder="465" value={form.smtp_port} onChange={set("smtp_port")} />
            </Field>
          </div>
          <Field label="Security">
            <Select value={form.smtp_security} onChange={(v) => setForm({ ...form, smtp_security: v })} options={SECURITY} />
          </Field>
          <div className="team-name-row">
            <Field label="Username" hint="Usually the full email address">
              <input className="input" autoComplete="off" value={form.smtp_username} onChange={set("smtp_username")} />
            </Field>
            <Field label="Password" hint={saved.smtp_connected ? "Saved. Leave empty to keep it." : "For Gmail, an app password."}>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Contact address in reminders" hint="Where schools write to about paying. Replies to reminders go here too.">
            <input className="input" type="email" value={form.contact_email} onChange={set("contact_email")} />
          </Field>
          <div className="btn-row">
            <Button type="button" variant="secondary" disabled={!saved.smtp_connected || busy !== ""} onClick={test}>
              {busy === "test" ? "Sending…" : "Send me a test email"}
            </Button>
          </div>
        </Card>

        <Card>
          <div className="plan-pay-head">
            <h3 style={{ margin: 0 }}>{"Paystack"}</h3>
            <Badge tone={saved.paystack_connected ? "success" : "warn"}>{saved.paystack_connected ? "Connected" : "Not set up"}</Badge>
          </div>
          <p className="plan-pay-note">
            {"Schools pay their plan into this account (Starter ₦450,000, Growth ₦950,000 a month). From your Paystack dashboard → Settings → API Keys."}
          </p>
          <div className="team-name-row">
            <Field label="Public key">
              <input className="input" placeholder="pk_live_…" autoComplete="off" value={form.paystack_public_key} onChange={set("paystack_public_key")} />
            </Field>
            <Field label="Secret key" hint={saved.paystack_connected ? "Saved. Leave empty to keep it." : "Starts with sk_live_ (or sk_test_ to try it out)."}>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="sk_live_…"
                value={paystackSecret}
                onChange={(e) => setPaystackSecret(e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <div className="btn-row">
          <Button type="submit" disabled={busy !== ""}>
            {busy === "save" ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </Page>
  );
};

export default PlatformSettings;
