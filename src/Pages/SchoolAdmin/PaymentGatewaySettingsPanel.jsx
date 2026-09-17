import React, { useCallback, useEffect, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchPaymentGateway,
  updatePaymentGatewaySetting,
  connectPaymentGateway,
} from "../../lib/api";
import { Card, Field, Button, Notice, Empty, Tabs, Select } from "../../Components/UI";

// Only Paystack has a working checkout/webhook adapter today (see
// supabase/functions/_shared/gateways/registry.ts) — this list is what
// keeps an unbuilt provider from ever being selectable here, rather than
// selectable-then-erroring at save time.
const IMPLEMENTED_PROVIDERS = {
  paystack: {
    label: "Paystack",
    fields: [
      { key: "secret_key", label: "Secret key", placeholder: "sk_live_...", secret: true },
      { key: "public_key", label: "Public key", placeholder: "pk_live_..." },
    ],
  },
};

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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
  }, [schoolId]);

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

    const activeProvider = IMPLEMENTED_PROVIDERS[provider];
    if (mode === "byo") {
      const missing = activeProvider.fields.filter((f) => f.secret && !credentials[f.key]?.trim());
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
        activeProvider.fields.forEach((f) => {
          const value = credentials[f.key]?.trim();
          if (!value) return;
          if (f.secret) secrets[f.key] = value;
          else publicConfig[f.key] = value;
        });
      }

      await connectPaymentGateway({
        schoolId,
        provider,
        mode,
        requireConfirmation: gateway?.require_confirmation ?? false,
        publicConfig,
        secrets: mode === "byo" ? secrets : undefined,
      });
      setCredentials({});
      setNotice(mode === "platform" ? "Now using Schoolivio's shared account." : "Connected — your own account will now take payments.");
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

  if (loading) return <Empty>{"Loading..."}</Empty>;

  const activeProvider = IMPLEMENTED_PROVIDERS[provider] || IMPLEMENTED_PROVIDERS.paystack;

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
      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

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
                  options={Object.entries(IMPLEMENTED_PROVIDERS).map(([key, p]) => ({ value: key, label: p.label }))}
                />
              </Field>
              {activeProvider.fields.map((f) => (
                <Field key={f.key} label={f.label}>
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
                {"Credentials are encrypted at rest and never shown again after saving — only an Edge Function ever reads them, to actually start or verify a payment."}
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
