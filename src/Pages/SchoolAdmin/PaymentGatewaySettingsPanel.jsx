import React, { useCallback, useEffect, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchPaymentGateway,
  updatePaymentGatewaySetting,
  connectPaymentGateway,
} from "../../lib/api";
import { Card, Field, Button, Notice, Tabs, Select, SkeletonText } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

// Every provider with a working checkout/webhook adapter (see
// supabase/functions/_shared/gateways/registry.ts) — this list is what
// keeps an unbuilt provider from ever being selectable here, rather than
// selectable-then-erroring at save time. Flutterwave and Stripe each need
// one more secret than Paystack does: neither can be verified from the API
// secret key alone, because neither derives its webhook signature from
// it — Flutterwave compares against a fixed "secret hash" you set in your
// dashboard, Stripe signs with a separate webhook signing secret. Marked
// `secret: true` like the API key itself, since both live in the same
// encrypted Vault blob, never in public_config.
const IMPLEMENTED_PROVIDERS = {
  paystack: {
    label: "Paystack",
    fields: [
      { key: "secret_key", label: "Secret key", placeholder: "sk_live_...", secret: true },
      { key: "public_key", label: "Public key", placeholder: "pk_live_..." },
    ],
  },
  flutterwave: {
    label: "Flutterwave",
    fields: [
      { key: "secret_key", label: "Secret key", placeholder: "FLWSECK-...", secret: true },
      { key: "public_key", label: "Public key", placeholder: "FLWPUBK-..." },
      {
        key: "hash",
        label: "Webhook secret hash",
        placeholder: "Set under Settings → Webhooks in your Flutterwave dashboard",
        secret: true,
        hint: "Not your API key — a separate value you set yourself in Flutterwave's dashboard, then paste the same value here so we can tell a real webhook from a forged one.",
      },
    ],
  },
  stripe: {
    label: "Stripe",
    fields: [
      { key: "secret_key", label: "Secret key", placeholder: "sk_live_...", secret: true },
      { key: "public_key", label: "Publishable key", placeholder: "pk_live_..." },
      {
        key: "webhook_secret",
        label: "Webhook signing secret",
        placeholder: "whsec_...",
        secret: true,
        hint: "From the webhook endpoint you create in Stripe pointing at this school's Stripe webhook URL — not the API secret key above.",
      },
    ],
  },
};

// Not a real provider — picking it just tells the server "figure out which
// of the above this key belongs to." Kept out of IMPLEMENTED_PROVIDERS
// (which doubles as "the providers pay-init/the webhooks actually know how
// to run") and shown as generic secret_key/public_key fields, since we
// don't know yet which extra field (if any) will turn out to be needed.
const OTHER_PROVIDER = "other";
const PROVIDER_OPTIONS = [
  ...Object.entries(IMPLEMENTED_PROVIDERS).map(([key, p]) => ({ value: key, label: p.label })),
  { value: OTHER_PROVIDER, label: "Other / not listed" },
];
const OTHER_FIELDS = [
  { key: "secret_key", label: "Secret key", placeholder: "Your gateway's secret/private key", secret: true },
  { key: "public_key", label: "Public key", placeholder: "Your gateway's public key (if it has one)" },
];

const Toggle = ({ label, hint, checked, onChange, disabled }) => (
  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
    <span>
      <div style={{ fontWeight: 600 }}>{label}</div>
      {hint ? <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{hint}</div> : null}
    </span>
  </label>
);

const PaymentGatewaySettingsPanel = () => {
  const { schoolId } = useSchool();
  const [gateway, setGateway] = useState(null);
  const [loading, setLoading] = useState(true);
  const { setError, setNotice } = useActionFeedback();

  const [mode, setMode] = useState("platform");
  const [provider, setProvider] = useState("paystack");
  const [credentials, setCredentials] = useState({});
  const [saving, setSaving] = useState(false);

  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const row = await fetchPaymentGateway(schoolId);
      setGateway(row);
      // Only seed the picker from a REAL prior choice — row.provider/mode
      // are null until an owner/admin has actually picked one (nothing to
      // edit yet), and setting the picker to null would either leave both
      // tabs unhighlighted or, worse, silently pre-select one as if it
      // were already the truth. "platform"/"paystack" here are just this
      // form's own starting suggestion, never a claim about what's live.
      if (row?.provider) {
        setMode(row.mode);
        setProvider(row.provider);
      }
    } catch (err) {
      setError(err.message || "Could not load this school's payment settings.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, setError]);

  useEffect(() => { load(); }, [load]);

  const setCredential = (key) => (e) => setCredentials((c) => ({ ...c, [key]: e.target.value }));

  const pickMode = (key) => {
    setMode(key);
    setCredentials({});
    setError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

    const activeFields = provider === OTHER_PROVIDER ? OTHER_FIELDS : IMPLEMENTED_PROVIDERS[provider].fields;
    if (mode === "byo") {
      // Every secret-marked field is required, not just the API key — a
      // Flutterwave/Stripe connection missing its webhook hash/signing
      // secret would pass the "does this key authenticate" check below and
      // still never actually confirm a real payment automatically.
      const missing = activeFields.filter((f) => f.secret && !credentials[f.key]?.trim());
      if (missing.length) {
        setError(`Enter ${missing.map((f) => f.label.toLowerCase()).join(" and ")} to connect your own account.`);
        return;
      }
    }

    setSaving(true);
    try {
      const secrets = {};
      const publicConfig = {};
      if (mode === "byo") {
        activeFields.forEach((f) => {
          const value = credentials[f.key]?.trim();
          if (!value) return;
          if (f.secret) secrets[f.key] = value;
          else publicConfig[f.key] = value;
        });
      }

      const result = await connectPaymentGateway({
        schoolId,
        provider,
        mode,
        requireConfirmation: gateway?.require_confirmation ?? false,
        publicConfig,
        secrets: mode === "byo" ? secrets : undefined,
      });
      setCredentials({});

      if (result?.detectedProvider) {
        const detected = IMPLEMENTED_PROVIDERS[result.detectedProvider];
        const extraFields = detected.fields.filter((f) => f.secret && f.key !== "secret_key");
        setNotice(
          extraFields.length
            ? `Connected — that key was recognised as your ${detected.label} account. Switch the provider above to ${detected.label} and add your ${extraFields.map((f) => f.label.toLowerCase()).join(" and ")} too, so payments can be confirmed automatically.`
            : `Connected — that key was recognised as your ${detected.label} account.`
        );
      } else {
        setNotice(mode === "platform" ? "Now using Schoolivio's shared account." : "Connected — your own account will now take payments.");
      }
      await load();
    } catch (err) {
      setError(err.message || "Could not save that.");
    } finally {
      setSaving(false);
    }
  };

  const toggleConfirmation = async (value) => {
    setError("");
    setConfirmBusy(true);
    // Optimistic — this is a single, narrow, instant-save toggle, not the
    // mode/provider form above.
    setGateway((g) => (g ? { ...g, require_confirmation: value } : g));
    try {
      const updated = await updatePaymentGatewaySetting({ schoolId, requireConfirmation: value });
      setGateway(updated);
    } catch (err) {
      setError(err.message || "Could not save that.");
      await load();
    } finally {
      setConfirmBusy(false);
    }
  };

  if (loading) return <SkeletonText lines={6} />;

  const activeFields = provider === OTHER_PROVIDER ? OTHER_FIELDS : (IMPLEMENTED_PROVIDERS[provider] || IMPLEMENTED_PROVIDERS.paystack).fields;

  const currentlyLabel = !gateway?.provider
    ? "Not connected — online payments will not work for this school until an owner or admin chooses one below."
    : gateway.mode === "platform"
    ? "Schoolivio's shared Paystack account."
    : `Your own ${IMPLEMENTED_PROVIDERS[gateway.provider]?.label || gateway.provider} account.`;

  return (
    <div>
      {gateway && !gateway.provider ? (
        <Notice tone="muted">
          {"This school has not connected a payment gateway yet — nobody has chosen one. Online payments are switched off until an owner or admin picks something below."}
        </Notice>
      ) : null}

      <Card style={{ marginBottom: 16, maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>{"Payment gateway"}</h3>
        <p style={{ color: "var(--ink-3)", fontSize: 14, marginTop: 0 }}>
          {"How online payments for this school actually get charged — Schoolivio's own shared account, or one you connect yourself."}
        </p>
        <p style={{ fontSize: 13.5, marginTop: 0 }}>
          <strong>{"Currently: "}</strong>
          {currentlyLabel}
        </p>

        <div style={{ marginBottom: 16 }}>
          <Tabs
            tabs={[
              { id: "platform", label: "Use Schoolivio's shared account" },
              { id: "byo", label: "Connect your own account" },
            ]}
            active={mode}
            onChange={pickMode}
          />
        </div>

        <form onSubmit={save}>
          {mode === "byo" ? (
            <>
              <Field label="Provider">
                <Select
                  value={provider}
                  onChange={(value) => { setProvider(value); setCredentials({}); }}
                  options={PROVIDER_OPTIONS}
                />
              </Field>
              {provider === OTHER_PROVIDER ? (
                <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: -8 }}>
                  {"Don't see your gateway above? Enter its keys below and we'll check them against the gateways we do support — if one of those accepts the key, we'll connect it under its real name."}
                </p>
              ) : null}
              {activeFields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  <input
                    className="input"
                    type={f.secret ? "password" : "text"}
                    placeholder={f.placeholder}
                    value={credentials[f.key] || ""}
                    onChange={setCredential(f.key)}
                    autoComplete="off"
                  />
                </Field>
              ))}
              <p style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {"Credentials are encrypted at rest and never shown again after saving. Before anything is saved, we make a read-only call to the gateway itself to confirm the key actually works — a wrong or revoked key is rejected here, not the first time a family tries to pay."}
              </p>
            </>
          ) : (
            <p style={{ color: "var(--ink-3)", fontSize: 13.5 }}>
              {"Nothing to set up — payments settle through Schoolivio's own Paystack account. Free to switch to your own account at any time."}
            </p>
          )}

          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : mode === "platform" ? "Confirm this choice" : "Connect this account"}
          </Button>
        </form>
      </Card>

      <Card style={{ marginBottom: 16, maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>{"Bursary confirmation"}</h3>
        <Toggle
          label="Require a bursary confirmation for every gateway payment"
          hint="On: even a successful payment through the gateway waits in the Payment queue until a bursar confirms it. Off (default): a successful payment settles immediately, no queue step. Applies to term fees, application fees and acceptance fees alike."
          checked={!!gateway?.require_confirmation}
          disabled={confirmBusy || !gateway}
          onChange={toggleConfirmation}
        />
      </Card>
    </div>
  );
};

export default PaymentGatewaySettingsPanel;
