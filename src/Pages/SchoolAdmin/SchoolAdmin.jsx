import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { lock } from "react-icons-kit/feather/lock";
import { userCheck } from "react-icons-kit/feather/userCheck";
import { users as usersIcon } from "react-icons-kit/feather/users";
import { gitMerge } from "react-icons-kit/feather/gitMerge";
import { calendar as calendarIcon } from "react-icons-kit/feather/calendar";
import { layers } from "react-icons-kit/feather/layers";
import { grid } from "react-icons-kit/feather/grid";
import { fileText } from "react-icons-kit/feather/fileText";
import { tag } from "react-icons-kit/feather/tag";
import { creditCard } from "react-icons-kit/feather/creditCard";
import { mail as mailIcon } from "react-icons-kit/feather/mail";
import { toggleRight } from "react-icons-kit/feather/toggleRight";
import { settings as settingsIcon } from "react-icons-kit/feather/settings";
import { chevronDown } from "react-icons-kit/feather/chevronDown";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import LevelsPanel from "./LevelsPanel";
import AcademicPanel from "./AcademicPanel";
import ClassesPanel from "./ClassesPanel";
import AdmissionsSettingsPanel from "./AdmissionsSettingsPanel";
import PaymentGatewaySettingsPanel from "./PaymentGatewaySettingsPanel";
import ModulesPanel from "./ModulesPanel";
import FeesSetupPanel from "./FeesSetupPanel";
import StudentRegistrationsPanel from "./StudentRegistrationsPanel";
import OrganogramPanel from "./OrganogramPanel";
import SecurityPanel from "./SecurityPanel";
import SchoolAccessPanel from "./SchoolAccessPanel";
import BillingPanel from "./BillingPanel";
import MailSettingsPanel from "../Mail/MailSettingsPanel";
import PeopleSection from "./people/PeopleSection";
import { CountrySelect, CurrencySelect, TimeZoneSelect } from "../../Components/LocalePickers";
import { currencyLabel } from "../../lib/currencies";
import { shield } from "react-icons-kit/feather/shield";
import {
  updateSchool,
  uploadSchoolLogo,
  removeSchoolLogo,
  uploadSchoolSignature,
  removeSchoolSignature,
  fetchTicketMailboxes,
  connectTicketMailbox,
  setMailboxActive,
  deleteTicketMailbox,
} from "../../lib/api";
import { ImageUpload } from "../../Components/ImageUpload";
import { applyTenantBranding } from "../../lib/branding";
import AdmissionLetter, { LETTER_MERGE_TAGS } from "../Admissions/AdmissionLetter";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Empty,
  Tabs,
  Select,
  formatDate,
  SkeletonText,
  SkeletonList,
} from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";

/* ------------------------------------------------------------------ people */
// The list and the person panel live in ./people (TypeScript, Tailwind),
// laid out like Microsoft 365's Active users.

/* ---------------------------------------------------------------- settings */
const DEFAULT_BRAND_COLOR = "#6d3fc4";
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const SettingsPanel = () => {
  const { school, reload } = useSchool();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    logo_url: "",
    theme_color: "",
    signature_url: "",
    signatory_name: "",
    signatory_title: "",
    admission_letter_offer_intro: "",
    admission_letter_enrolled_intro: "",
    admission_letter_closing: "",
    currency: "NGN",
    timezone: "Africa/Lagos",
    country: "",
  });
  const [saving, setSaving] = useState(false);
  const [previewStatus, setPreviewStatus] = useState(null);
  const { setError, setNotice } = useActionFeedback();

  useEffect(() => {
    if (!school) return;
    setForm({
      name: school.name || "",
      email: school.email || "",
      phone: school.phone || "",
      address: school.address || "",
      logo_url: school.logo_url || "",
      theme_color: school.theme_color || "",
      signature_url: school.signature_url || "",
      signatory_name: school.signatory_name || "",
      signatory_title: school.signatory_title || "",
      admission_letter_offer_intro: school.admission_letter_offer_intro || "",
      admission_letter_enrolled_intro: school.admission_letter_enrolled_intro || "",
      admission_letter_closing: school.admission_letter_closing || "",
      currency: school.currency || "NGN",
      timezone: school.timezone || "Africa/Lagos",
      country: school.country || "",
    });
  }, [school]);

  // Live preview: recolour/re-badge this admin's own tab as they pick,
  // before Save persists anything. Reverts to the school's actual saved
  // branding on the way out — leaving the panel shouldn't leave a preview
  // stuck on screen if they never saved it.
  useEffect(() => {
    if (!school) return undefined;
    applyTenantBranding({
      name: school.name,
      logoUrl: form.logo_url,
      themeColor: form.theme_color,
    });
    return () => {
      applyTenantBranding({
        name: school.name,
        logoUrl: school.logo_url,
        themeColor: school.theme_color,
      });
    };
  }, [school, form.logo_url, form.theme_color]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const themeColor = form.theme_color.trim();
    if (themeColor && !HEX_COLOR_RE.test(themeColor)) {
      setError("Theme colour must be a hex code like #2563eb.");
      return;
    }
    // Amounts are never converted: a fee of 45,000 stays 45,000 in the new
    // currency. Fine for a school that chose the wrong one at sign-up; worth a
    // pause for one that already has bills and payslips.
    if (form.currency !== (school.currency || "NGN")) {
      const ok = await confirmDialog({
        title: `Change the school's currency to ${currencyLabel(form.currency)}?`,
        body: "Fees, bills, store prices and salaries will show in the new currency. Amounts already entered are not converted: 45,000 stays 45,000.",
        confirmLabel: "Change currency",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await updateSchool(school.id, {
        currency: form.currency,
        timezone: form.timezone,
        country: form.country || null,
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        logo_url: form.logo_url.trim() || null,
        theme_color: themeColor || null,
        signature_url: form.signature_url.trim() || null,
        signatory_name: form.signatory_name.trim() || null,
        signatory_title: form.signatory_title.trim() || null,
        admission_letter_offer_intro: form.admission_letter_offer_intro.trim() || null,
        admission_letter_enrolled_intro: form.admission_letter_enrolled_intro.trim() || null,
        admission_letter_closing: form.admission_letter_closing.trim() || null,
      });
      await reload();
      setNotice("School details saved.");
    } catch (err) {
      setError(err.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  if (!school) return <SkeletonText lines={8} />;

  if (previewStatus) {
    const enrolled = previewStatus === "enrolled";
    return (
      <AdmissionLetter
        application={{
          reference: "SAMPLE/2026/0001",
          first_name: "Ada",
          middle_name: "",
          surname: "Okafor",
          date_of_birth: "2014-04-15",
          guardian_name: "Mr & Mrs Okafor",
          status: previewStatus,
          offer_expires_at: enrolled ? null : new Date(Date.now() + 14 * 86400000).toISOString(),
          registration_number: enrolled ? "REG-0001" : null,
          sessions: { name: "2026/2027" },
          classes: { name: "JSS 1" },
          schools: { ...school, ...form },
        }}
        onClose={() => setPreviewStatus(null)}
      />
    );
  }

  return (
    <Card style={{ maxWidth: 620 }}>
      <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 14 }}>
        {"This school lives at "}
        <code>{`${school.slug}.schoolivio.com`}</code>
        {". The address cannot be changed here — ask the platform team."}
      </p>
      <form onSubmit={handleSubmit}>
        <Field label="School name">
          <input className="input" value={form.name} onChange={update("name")} />
        </Field>
        <Field label="Contact email">
          <input type="email" className="input" value={form.email} onChange={update("email")} />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} onChange={update("phone")} />
        </Field>
        <Field label="Address">
          <textarea className="textarea" style={{ minHeight: 80 }} value={form.address} onChange={update("address")} />
        </Field>
        <Field label="Country" hint="Where the school is. Payroll starts with this country's pay rules only for Nigeria; elsewhere you enter your own tax bands under Payroll → Settings.">
          <CountrySelect value={form.country} onChange={(country) => setForm((f) => ({ ...f, country }))} />
        </Field>
        <div className="split">
          <Field label="Currency" hint="What the school bills parents, sells and pays salaries in.">
            <CurrencySelect value={form.currency} onChange={(currency) => setForm((f) => ({ ...f, currency }))} />
          </Field>
          <Field label="Time zone" hint="Dates, deadlines and reminders follow this.">
            <TimeZoneSelect value={form.timezone} onChange={(timezone) => setForm((f) => ({ ...f, timezone }))} />
          </Field>
        </div>
        <Field
          label="Logo"
          hint="Replaces the Schoolivio mark everywhere this school's app shows it — the sidebar, the sign-in screen, the applicant portal, and the browser tab icon. Until one is set, Schoolivio's own mark is shown as a placeholder."
        >
          <ImageUpload
            value={form.logo_url}
            shape="square"
            onUpload={async (file) => {
              const url = await uploadSchoolLogo({ schoolId: school.id, file });
              setForm((current) => ({ ...current, logo_url: url }));
            }}
            onRemove={async () => {
              await removeSchoolLogo(form.logo_url);
              setForm((current) => ({ ...current, logo_url: "" }));
            }}
          />
        </Field>
        <Field
          label="Authorised signature"
          hint="Appears on official documents issued through the portal, starting with the admission letter, under the signatory's name and title below."
        >
          <ImageUpload
            value={form.signature_url}
            shape="square"
            onUpload={async (file) => {
              const url = await uploadSchoolSignature({ schoolId: school.id, file });
              setForm((current) => ({ ...current, signature_url: url }));
            }}
            onRemove={async () => {
              await removeSchoolSignature(form.signature_url);
              setForm((current) => ({ ...current, signature_url: "" }));
            }}
          />
        </Field>
        <Field label="Signatory name" hint="The person whose signature this is, e.g. “Adaeze Okafor”.">
          <input className="input" value={form.signatory_name} onChange={update("signatory_name")} />
        </Field>
        <Field label="Signatory title" hint="Their role, e.g. “Principal” or “Head of Admissions”.">
          <input className="input" value={form.signatory_title} onChange={update("signatory_title")} />
        </Field>

        <div style={{ margin: "18px 0 4px" }}>
          <strong style={{ fontSize: 14 }}>{"Admission letter wording"}</strong>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            {"Leave these blank and the admission letter keeps Schoolivio's own default wording. Write your own and it's used instead — everything else on the letter (the facts table, offer expiry and fee notices, and the signature above) stays the same either way."}
          </p>
          <p style={{ margin: "6px 0 0", color: "var(--ink-3)", fontSize: 12.5 }}>
            {"Available in any of the fields below: "}
            {LETTER_MERGE_TAGS.map(([tag], i) => (
              <React.Fragment key={tag}>
                {i > 0 ? ", " : ""}
                <code>{`{{${tag}}}`}</code>
              </React.Fragment>
            ))}
            {". Leave a blank line to start a new paragraph."}
          </p>
        </div>
        <Field label="Offer letter — opening paragraph" hint="Used when an applicant is offered a place.">
          <textarea
            className="textarea"
            style={{ minHeight: 100 }}
            placeholder={`Following our review of the application submitted on your behalf, we are pleased to offer {{applicant_name}} a place at {{school_name}}.`}
            value={form.admission_letter_offer_intro}
            onChange={update("admission_letter_offer_intro")}
          />
        </Field>
        <Field label="Enrolment letter — opening paragraph" hint="Used once the applicant is enrolled.">
          <textarea
            className="textarea"
            style={{ minHeight: 100 }}
            placeholder={`We are pleased to confirm that {{applicant_name}} has been enrolled at {{school_name}}.`}
            value={form.admission_letter_enrolled_intro}
            onChange={update("admission_letter_enrolled_intro")}
          />
        </Field>
        <Field label="Closing line" hint="Shared by both letters, printed just before the signature.">
          <textarea
            className="textarea"
            style={{ minHeight: 60 }}
            placeholder="We look forward to welcoming your family to the school."
            value={form.admission_letter_closing}
            onChange={update("admission_letter_closing")}
          />
        </Field>
        <div className="btn-row" style={{ marginBottom: 12 }}>
          <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewStatus("offered")}>
            {"Preview offer letter"}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewStatus("enrolled")}>
            {"Preview enrolment letter"}
          </Button>
        </div>

        <Field
          label="Theme colour"
          hint="Recolours buttons, active tabs, badges and highlights across this school's app — sign-in included. Leave it as Schoolivio's own purple until you'd rather match your school's colours."
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="color"
              value={HEX_COLOR_RE.test(form.theme_color) ? form.theme_color : DEFAULT_BRAND_COLOR}
              onChange={(e) => setForm((current) => ({ ...current, theme_color: e.target.value }))}
              style={{ width: 44, height: 36, padding: 2, border: "1px solid var(--line)", borderRadius: 8, background: "none", cursor: "pointer" }}
              aria-label="Theme colour"
            />
            <input
              className="input"
              style={{ maxWidth: 140 }}
              value={form.theme_color}
              onChange={update("theme_color")}
              placeholder={DEFAULT_BRAND_COLOR}
            />
            {form.theme_color ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((current) => ({ ...current, theme_color: "" }))}
              >
                {"Reset to default"}
              </Button>
            ) : null}
          </div>
        </Field>

        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </form>
    </Card>
  );
};

/* ----------------------------------------------------------------- mailboxes */
const POLL_STATUS_TONE = { ok: "success", error: "danger" };

// A school's mailbox is very often hosted on one of these even when the
// address itself is on the school's own domain (e.g. info@theschool.com
// routed through Google Workspace) — the IMAP/SMTP host/port/security a
// provider wants are public, standard facts, not something to retype from
// memory every time.
const PROVIDER_PRESETS = {
  gmail: {
    label: "Gmail / Google Workspace",
    imapHost: "imap.gmail.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.gmail.com", smtpPort: "587", smtpSecurity: "starttls",
  },
  outlook: {
    label: "Outlook.com / Hotmail (personal account)",
    imapHost: "imap-mail.outlook.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp-mail.outlook.com", smtpPort: "587", smtpSecurity: "starttls",
  },
  microsoft365: {
    label: "Microsoft 365 (work/school account)",
    imapHost: "outlook.office365.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.office365.com", smtpPort: "587", smtpSecurity: "starttls",
    hint: "Only works if your Microsoft 365 admin has turned on SMTP AUTH/IMAP for this mailbox — most organizations turn it off by default now. If connecting fails, a dedicated Microsoft 365 sign-in connection is coming soon.",
  },
  yahoo: {
    label: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.mail.yahoo.com", smtpPort: "465", smtpSecurity: "ssl",
  },
  zoho: {
    label: "Zoho Mail",
    imapHost: "imap.zoho.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.zoho.com", smtpPort: "465", smtpSecurity: "ssl",
  },
  icloud: {
    label: "iCloud Mail",
    imapHost: "imap.mail.me.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.mail.me.com", smtpPort: "587", smtpSecurity: "starttls",
  },
};

const EMPTY_SERVER_FIELDS = { imapHost: "", imapPort: "993", imapSecurity: "ssl", smtpHost: "", smtpPort: "587", smtpSecurity: "starttls" };

const ConnectMailboxForm = ({ schoolId, onConnected, onCancel }) => {
  // Two distinct, equally-visible ways in — not one hidden behind the
  // other. "App password" picks a known provider and fills in its server
  // settings; "SMTP / IMAP details" is for anything else, filled in by hand.
  const [method, setMethod] = useState("app_password");
  const [provider, setProvider] = useState("gmail");
  const [form, setForm] = useState({
    label: "Support",
    address: "",
    displayName: "",
    ...PROVIDER_PRESETS.gmail,
    username: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const { setError } = useActionFeedback();

  const set = (field) => (e) => setForm((c) => ({ ...c, [field]: e.target.value }));

  // Most providers want the full email address as the username — filled in
  // automatically until the admin types a username of their own.
  const [usernameTouched, setUsernameTouched] = useState(false);
  const setAddress = (e) => {
    const value = e.target.value;
    setForm((c) => ({ ...c, address: value, username: usernameTouched ? c.username : value }));
  };
  const setUsername = (e) => {
    setUsernameTouched(true);
    setForm((c) => ({ ...c, username: e.target.value }));
  };

  const applyProvider = (key) => {
    const preset = PROVIDER_PRESETS[key];
    setForm((c) => ({
      ...c,
      imapHost: preset.imapHost, imapPort: preset.imapPort, imapSecurity: preset.imapSecurity,
      smtpHost: preset.smtpHost, smtpPort: preset.smtpPort, smtpSecurity: preset.smtpSecurity,
    }));
  };

  const pickProvider = (key) => {
    setProvider(key);
    applyProvider(key);
  };

  const pickMethod = (key) => {
    setMethod(key);
    if (key === "app_password") applyProvider(provider);
    else setForm((c) => ({ ...c, ...EMPTY_SERVER_FIELDS }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.address.trim() || !form.imapHost.trim() || !form.smtpHost.trim() || !form.username.trim() || !form.password) {
      setError(
        method === "smtp"
          ? "The address, IMAP host, SMTP host, username and password are all required."
          : "The address, username and app password are all required."
      );
      return;
    }
    setSaving(true);
    try {
      await connectTicketMailbox({
        schoolId,
        label: form.label.trim(),
        address: form.address.trim(),
        displayName: form.displayName.trim(),
        provider: "imap_smtp",
        imapHost: form.imapHost.trim(),
        imapPort: Number(form.imapPort) || 993,
        imapSecurity: form.imapSecurity,
        smtpHost: form.smtpHost.trim(),
        smtpPort: Number(form.smtpPort) || 587,
        smtpSecurity: form.smtpSecurity,
        username: form.username.trim(),
        password: form.password,
      });
      onConnected();
    } catch (err) {
      setError(err.message || "Could not connect that mailbox.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ marginBottom: 18, maxWidth: 640 }}>
      <h3 style={{ marginTop: 0 }}>{"Connect a mailbox"}</h3>
      <p style={{ color: "var(--ink-3)", fontSize: 14, marginTop: 0 }}>
        {"Two ways to connect, side by side — pick whichever matches what you have: a known provider and its app password, or your mail server's own SMTP/IMAP details."}
      </p>
      <div style={{ marginBottom: 16 }}>
        <Tabs
          tabs={[
            { id: "app_password", label: "App password" },
            { id: "smtp", label: "SMTP / IMAP details" },
          ]}
          active={method}
          onChange={pickMethod}
        />
      </div>
      <form onSubmit={submit}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label="Label" hint="Shown to staff if there's more than one mailbox.">
            <input className="input" value={form.label} onChange={set("label")} />
          </Field>
          <Field label="Address">
            <input className="input" type="email" placeholder="info@yourschool.com" value={form.address} onChange={setAddress} />
          </Field>
        </div>

        {method === "app_password" ? (
          <Field label="Provider" hint={PROVIDER_PRESETS[provider].hint || "Fills in the server settings below — check them against your provider if a field looks wrong."}>
            <Select
              className="select"
              value={provider}
              onChange={pickProvider}
              options={Object.entries(PROVIDER_PRESETS).map(([key, preset]) => ({ value: key, label: preset.label }))}
            />
          </Field>
        ) : null}

        <Field label="Display name" hint="How the school's name shows up in a recipient's inbox.">
          <input className="input" placeholder="Jane-Nath College Support" value={form.displayName} onChange={set("displayName")} />
        </Field>

        {method === "smtp" ? (
          <div className="split" style={{ marginTop: 6 }}>
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: 13.5 }}>{"Incoming (IMAP)"}</h4>
              <Field label="Host">
                <input className="input" placeholder="mail.yourprovider.com" value={form.imapHost} onChange={set("imapHost")} />
              </Field>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <Field label="Port">
                  <input className="input" value={form.imapPort} onChange={set("imapPort")} />
                </Field>
                <Field label="Security">
                  <Select
                    className="select"
                    value={form.imapSecurity}
                    onChange={(v) => setForm((c) => ({ ...c, imapSecurity: v }))}
                    options={[
                      { value: "ssl", label: "SSL/TLS" },
                      { value: "starttls", label: "STARTTLS" },
                      { value: "none", label: "None" },
                    ]}
                  />
                </Field>
              </div>
            </div>
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: 13.5 }}>{"Outgoing (SMTP)"}</h4>
              <Field label="Host">
                <input className="input" placeholder="mail.yourprovider.com" value={form.smtpHost} onChange={set("smtpHost")} />
              </Field>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <Field label="Port">
                  <input className="input" value={form.smtpPort} onChange={set("smtpPort")} />
                </Field>
                <Field label="Security">
                  <Select
                    className="select"
                    value={form.smtpSecurity}
                    onChange={(v) => setForm((c) => ({ ...c, smtpSecurity: v }))}
                    options={[
                      { value: "starttls", label: "STARTTLS" },
                      { value: "ssl", label: "SSL/TLS" },
                      { value: "none", label: "None" },
                    ]}
                  />
                </Field>
              </div>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "6px 0 14px" }}>
            {`Using ${form.imapHost} (IMAP) and ${form.smtpHost} (SMTP) — the standard settings for ${PROVIDER_PRESETS[provider].label}.`}
          </p>
        )}

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginTop: 6 }}>
          <Field label="Username" hint="Usually the full email address.">
            <input className="input" value={form.username} onChange={setUsername} />
          </Field>
          <Field
            label={method === "smtp" ? "Password" : "App password"}
            hint={method === "smtp" ? "Whatever this mailbox's own IMAP/SMTP login expects." : "Not your everyday password — this provider issues a separate app password for this."}
          >
            <input className="input" type="password" value={form.password} onChange={set("password")} />
          </Field>
        </div>

        <div className="btn-row" style={{ marginTop: 8 }}>
          <Button type="submit" disabled={saving}>{saving ? "Connecting..." : "Connect mailbox"}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>{"Cancel"}</Button>
        </div>
      </form>
    </Card>
  );
};

const MailboxesPanel = () => {
  const { schoolId } = useSchool();
  const [mailboxes, setMailboxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();
  const [busyId, setBusyId] = useState(null);
  const [showConnect, setShowConnect] = useState(false);

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    fetchTicketMailboxes(schoolId)
      .then(setMailboxes)
      .catch((err) => setError(err.message || "Could not load connected mailboxes."))
      .finally(() => setLoading(false));
  }, [schoolId, setError]);

  useEffect(load, [load]);

  const toggleActive = async (row) => {
    setBusyId(row.id);
    setError("");
    try {
      await setMailboxActive({ id: row.id, isActive: !row.is_active, schoolId });
      load();
    } catch (err) {
      setError(err.message || "Could not update that mailbox.");
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (row) => {
    if (!await confirmDialog(`Disconnect ${row.address}? Tickets already raised from it stay put — only new mail stops coming in.`)) return;
    setBusyId(row.id);
    setError("");
    try {
      await deleteTicketMailbox(row.id, schoolId);
      load();
    } catch (err) {
      setError(err.message || "Could not disconnect that mailbox.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 14, maxWidth: 560 }}>
          {"Connect the school's own support mailbox so an email in becomes a ticket, and a staff reply goes out as a real email — see it at "}
          <code>{"Tickets"}</code>
          {"."}
        </p>
        <Button onClick={() => setShowConnect((v) => !v)}>{showConnect ? "Cancel" : "Connect a mailbox"}</Button>
      </div>

      {showConnect ? (
        <ConnectMailboxForm
          schoolId={schoolId}
          onConnected={() => {
            setShowConnect(false);
            load();
          }}
          onCancel={() => setShowConnect(false)}
        />
      ) : null}

      {loading ? <SkeletonList rows={3} avatar={false} /> : null}
      {!loading && mailboxes.length === 0 ? <Empty>{"No mailbox connected yet."}</Empty> : null}

      {mailboxes.map((mb) => (
        <Card key={mb.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600 }}>
                {mb.label}
                {!mb.is_active ? (
                  <span style={{ marginLeft: 8 }}><Badge>{"disconnected"}</Badge></span>
                ) : null}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{mb.address}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
                {mb.last_poll_at ? (
                  <>
                    {"Last checked "}
                    {formatDate(mb.last_poll_at)}
                    {mb.last_poll_status ? (
                      <span style={{ marginLeft: 6 }}>
                        <Badge tone={POLL_STATUS_TONE[mb.last_poll_status]}>{mb.last_poll_status}</Badge>
                      </span>
                    ) : null}
                    {mb.last_poll_status === "error" && mb.last_poll_error ? ` — ${mb.last_poll_error}` : ""}
                  </>
                ) : (
                  "Not checked yet."
                )}
              </div>
            </div>
            <span className="btn-row">
              <Button variant="secondary" size="sm" disabled={busyId === mb.id} onClick={() => toggleActive(mb)}>
                {mb.is_active ? "Pause" : "Resume"}
              </Button>
              <Button variant="danger" size="sm" disabled={busyId === mb.id} onClick={() => disconnect(mb)}>
                {"Disconnect"}
              </Button>
            </span>
          </div>
        </Card>
      ))}
    </>
  );
};

// The sections, in the groups a school thinks in. Thirteen tabs in one row
// ran off the side of every screen, and two of them ("Classes & subjects",
// "Classes & departments") read as the same thing. Each now says what it is.
const SECTIONS = [
  {
    group: "People",
    items: [
      { id: "people", label: "People", icon: usersIcon, description: "Everyone who can sign in. Click a person to see and manage everything about them, parents and children included." },
      { id: "organogram", label: "Org chart", icon: gitMerge, description: "Who reports to whom across the school." },
      { id: "students", label: "Student records", icon: userCheck, description: "Registered pupils, their admission numbers and standing." },
    ],
  },
  {
    group: "Teaching",
    items: [
      { id: "academic", label: "Calendar", icon: calendarIcon, description: "Sessions and terms, and which one is current." },
      { id: "levels", label: "Levels & departments", icon: layers, description: "Year groups (JSS 1, Year 7) or departments (Science, Arts) the school sorts by." },
      { id: "classes", label: "Classes & subjects", icon: grid, description: "The actual classes with pupils in them, their form teachers, and the subjects taught." },
    ],
  },
  {
    group: "Admissions & money",
    items: [
      { id: "admissions", label: "Admissions", icon: fileText, description: "Application and acceptance fees, and what the application form asks for." },
      { id: "fees", label: "Fees setup", icon: tag, description: "The charges and discounts the school uses, named once for every term." },
      { id: "payments", label: "Online payments", icon: creditCard, description: "The payment gateway parents pay through, and how the bursary confirms payments." },
    ],
  },
  {
    group: "School",
    items: [
      { id: "mail", label: "Mail settings", icon: mailIcon, description: "Staff email addresses, and the school's own domain and Resend account for mail to outside addresses." },
      { id: "mailboxes", label: "Ticket mailboxes", icon: mailIcon, description: "Email accounts whose messages arrive as tickets." },
      { id: "modules", label: "Modules", icon: toggleRight, description: "Switch parts of Schoolivio on or off for this school." },
      { id: "security", label: "Security", icon: lock, description: "Sign people out after a set time of inactivity, or not at all." },
      { id: "access", label: "Schoolivio access", icon: shield, description: "Let Schoolivio support into your school for a set time, or decline." },
      { id: "billing", label: "Plan & billing", icon: creditCard, description: "Your Schoolivio plan, when it ends, and paying for it with Paystack." },
      { id: "settings", label: "School settings", icon: settingsIcon, description: "Name, logo, colours, contact details and letters." },
    ],
  },
];
const ALL_SECTIONS = SECTIONS.flatMap((g) => g.items.map((item) => ({ ...item, group: g.group })));
const TABS = ALL_SECTIONS.map((s) => s.id);

const PANELS = {
  people: PeopleSection,
  organogram: OrganogramPanel,
  academic: AcademicPanel,
  classes: ClassesPanel,
  levels: LevelsPanel,
  admissions: AdmissionsSettingsPanel,
  students: StudentRegistrationsPanel,
  mail: MailSettingsPanel,
  mailboxes: MailboxesPanel,
  payments: PaymentGatewaySettingsPanel,
  fees: FeesSetupPanel,
  modules: ModulesPanel,
  security: SecurityPanel,
  access: SchoolAccessPanel,
  billing: BillingPanel,
  settings: SettingsPanel,
};

// The grouped list, shared by the side menu and the phone's section picker.
const SectionList = ({ active, onPick }) => (
  <>
    {SECTIONS.map((g) => (
      <div key={g.group} className="sa-nav-group">
        <span className="sa-nav-group-label">{g.group}</span>
        <ul>
          {g.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`sa-nav-item${active === item.id ? " active" : ""}`}
                aria-current={active === item.id ? "page" : undefined}
                onClick={() => onPick(item.id)}
              >
                <Icon icon={item.icon} size={16} />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    ))}
  </>
);

const SchoolAdmin = () => {
  const { school } = useSchool();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get("tab");
    return TABS.includes(requested) ? requested : "people";
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  // A link elsewhere in the app (e.g. "prepare items from config" finding
  // nothing configured) can point straight at a tab here via ?tab=... —
  // this keeps that landing tab in sync if the query string changes after
  // mount too, not just on the initial load.
  useEffect(() => {
    const requested = searchParams.get("tab");
    if (requested && TABS.includes(requested) && requested !== tab) {
      setTab(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const changeTab = (id) => {
    setTab(id);
    setPickerOpen(false);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", id);
        // A subtab param only means something on the admissions tab — drop
        // it once we're not there, so it doesn't silently reapply to the
        // wrong subtab if the admin comes back to admissions later.
        if (id !== "admissions") next.delete("subtab");
        return next;
      },
      { replace: true }
    );
  };

  const current = ALL_SECTIONS.find((s) => s.id === tab) || ALL_SECTIONS[0];
  const Panel = PANELS[current.id];

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="School administration"
        subtitle={school ? `${school.name} · ${school.slug}.schoolivio.com` : ""}
      >
        <div className="sa-layout">
          {/* Stays in place while a section scrolls. */}
          <nav className="sa-nav" aria-label="Administration sections">
            <SectionList active={current.id} onPick={changeTab} />
          </nav>

          <div className="sa-content">
            {/* Phone: no room for the side menu, so the section is a picker. */}
            <div className="sa-picker">
              <button
                type="button"
                className="sa-picker-button"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((v) => !v)}
              >
                <Icon icon={current.icon} size={16} />
                <span className="sa-picker-text">
                  <span className="sa-picker-group">{current.group}</span>
                  <strong>{current.label}</strong>
                </span>
                <Icon icon={chevronDown} size={18} />
              </button>
              {pickerOpen ? (
                <div className="sa-picker-panel">
                  <SectionList active={current.id} onPick={changeTab} />
                </div>
              ) : null}
            </div>

            <header className="sa-section-head">
              <span className="sa-section-icon" aria-hidden="true"><Icon icon={current.icon} size={20} /></span>
              <div>
                <span className="sa-section-group">{current.group}</span>
                <h2>{current.label}</h2>
                <p>{current.description}</p>
              </div>
            </header>

            <div className="sa-panel">
              <Panel />
            </div>
          </div>
        </div>
      </Page>
    </div>
  );
};

export default SchoolAdmin;
