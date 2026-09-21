import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { grid } from "react-icons-kit/feather/grid";
import { clipboard } from "react-icons-kit/feather/clipboard";
import { creditCard } from "react-icons-kit/feather/creditCard";
import { edit } from "react-icons-kit/feather/edit";
import { barChart2 } from "react-icons-kit/feather/barChart2";
import { search } from "react-icons-kit/feather/search";
import { layers } from "react-icons-kit/feather/layers";
import { lock } from "react-icons-kit/feather/lock";
import { bell } from "react-icons-kit/feather/bell";
import { fileText } from "react-icons-kit/feather/fileText";
import { checkCircle } from "react-icons-kit/feather/checkCircle";
import { cpu } from "react-icons-kit/feather/cpu";
import { settings } from "react-icons-kit/feather/settings";
import { home } from "react-icons-kit/feather/home";
import { clock } from "react-icons-kit/feather/clock";
import { award } from "react-icons-kit/feather/award";
import { user } from "react-icons-kit/feather/user";
import { check } from "react-icons-kit/feather/check";
import { zap } from "react-icons-kit/feather/zap";
import { supabase } from "../lib/supabaseClient";
import { Mark } from "../Components/Logo";

/* ── scroll-reveal hook ───────────────────────────────────────────────── */
function useReveal() {
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("visible");
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -5% 0px" }
    );
    const observe = () => {
      document.querySelectorAll(".mkt-reveal:not(.visible)").forEach((el) => obs.observe(el));
    };
    observe();
    // Force-reveal elements already in viewport (in case IO doesn't fire synchronously)
    const forceReveal = () => {
      document.querySelectorAll(".mkt-reveal:not(.visible)").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("visible");
      });
    };
    forceReveal();
    const t = setTimeout(forceReveal, 80);
    return () => { clearTimeout(t); obs.disconnect(); };
  }, []);
}

/* ── hand-drawn SVG underline ─────────────────────────────────────────── */
function HandDrawnUnderline({ color = "#7c4fe0", className = "" }) {
  return (
    <svg
      viewBox="0 0 200 20"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`mkt-underline-svg ${className}`}
    >
      <path
        d="M2 12 C 40 4, 70 17, 100 9 C 130 2, 160 15, 198 7"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        pathLength="1"
        className="mkt-underline-path"
      />
    </svg>
  );
}

/* ── data ─────────────────────────────────────────────────────────────── */
const MODULES = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: home,
    eyebrow: "Friday, 20 September",
    title: "Good morning, Jane-Nath College",
    stats: [
      { value: "612", label: "Students enrolled" },
      { value: "38",  label: "Staff on roster" },
      { value: "5",   label: "Notices this week" },
      { value: "3",   label: "Approvals pending" },
    ],
    rows: [
      { text: "Term 2 report cards — approval pending", tone: "y", badge: "Review" },
      { text: "New staff invite accepted — B. Oni",     tone: "g", badge: "Done" },
      { text: "Library clearance backlog — 2 pupils",   tone: "p", badge: "Attention" },
    ],
  },
  {
    key: "admissions",
    label: "Admissions",
    icon: clipboard,
    eyebrow: "Active session",
    title: "Admissions workspace",
    stats: [
      { value: "18",  label: "Awaiting decision" },
      { value: "6",   label: "Clearance in progress" },
      { value: "92%", label: "Fees reconciled" },
      { value: "4",   label: "New today" },
    ],
    rows: [
      { text: "JAN/2026/0041 — offer accepted",          tone: "g", badge: "Cleared" },
      { text: "JAN/2026/0039 — awaiting acceptance fee", tone: "y", badge: "Pending" },
      { text: "JAN/2026/0037 — screening complete",      tone: "p", badge: "In review" },
    ],
  },
  {
    key: "bursary",
    label: "Bursary",
    icon: creditCard,
    eyebrow: "Third term · 2025/2026",
    title: "Fees this term",
    stats: [
      { value: "₦15.3M", label: "Invoiced" },
      { value: "₦11.0M", label: "Collected" },
      { value: "71.9%",  label: "Collection rate" },
      { value: "9",      label: "Overdue" },
    ],
    rows: [
      { text: "JNC/INV/0182 — payment confirmed", tone: "g", badge: "Paid" },
      { text: "JNC/INV/0179 — reminder sent",    tone: "y", badge: "Due soon" },
      { text: "JNC/INV/0175 — 14 days overdue",  tone: "p", badge: "Overdue" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: barChart2,
    eyebrow: "Third term results",
    title: "Result sheets",
    stats: [
      { value: "9",   label: "Classes reported" },
      { value: "2",   label: "Awaiting approval" },
      { value: "76%", label: "Average pass rate" },
      { value: "412", label: "Report cards issued" },
    ],
    rows: [
      { text: "JSS 2 — result sheet approved",        tone: "g", badge: "Released" },
      { text: "SS 1 — awaiting principal sign-off",   tone: "y", badge: "Pending" },
      { text: "JSS 3 — grading in progress",          tone: "p", badge: "In review" },
    ],
  },
  {
    key: "school",
    label: "School",
    icon: settings,
    eyebrow: "Administration",
    title: "School settings",
    stats: [
      { value: "12", label: "Classes configured" },
      { value: "3",  label: "Clearance depts" },
      { value: "8",  label: "Staff roles" },
      { value: "1",  label: "Active session" },
    ],
    rows: [
      { text: "New clearance dept — Hostel",          tone: "g", badge: "Added" },
      { text: "Admissions officer invited — J. Daniyo", tone: "y", badge: "Pending" },
      { text: "Academic calendar updated 2026/2027",  tone: "p", badge: "Saved" },
    ],
  },
];

const SCHOOL_NAMES = [
  { name: "Jane-Nath College",        style: "serif lg" },
  { name: "Sunshine Academy",         style: "lg" },
  { name: "Greenfield Schools",       style: "sm" },
  { name: "Horizon International",    style: "serif lg" },
  { name: "TechBridge Academy",       style: "sm" },
  { name: "Bright Futures College",   style: "lg" },
  { name: "Crown Heights School",     style: "serif sm" },
  { name: "New Covenant College",     style: "sm" },
];

const STATS = [
  { value: "3 min", label: "Average offer turnaround" },
  { value: "100%",  label: "Actions logged to audit trail" },
  { value: "5",     label: "Modules in one workspace" },
  { value: "45d",   label: "Free trial, no card needed" },
];

const FEATURES = [
  {
    icon: grid,
    accent: "a",
    title: "One dashboard for the whole school",
    body: "Admissions, teaching, fees, exams and results in a single workspace — nobody switches between five different tools to run one school day.",
  },
  {
    icon: clipboard,
    accent: "b",
    title: "Admissions, start to finish",
    body: "Application → screening → offer → acceptance fee → clearance → enrolment, each step tracked and gated automatically.",
  },
  {
    icon: creditCard,
    accent: "c",
    title: "Fees parents actually understand",
    body: "Line-item invoices, plain-language payment status, online or manual payment — never just a wall of numbers.",
  },
  {
    icon: edit,
    accent: "a",
    title: "Exams built for the room",
    body: "MCQ and short-answer auto-grading, image-based questions, a real scientific calculator, and proctoring events logged live.",
  },
  {
    icon: barChart2,
    accent: "b",
    title: "Results without the spreadsheet chase",
    body: "Result sheets, an approval workflow before anything is released, and report cards a parent can actually read.",
  },
  {
    icon: search,
    accent: "c",
    title: "Every action, accounted for",
    body: "Who did what, when, and from where — a full audit trail across admissions, bursary, teaching and every role.",
  },
];

const CAPABILITIES = [
  {
    key: "multitenant",
    icon: layers,
    tab: "Multi-tenant",
    title: "One platform, every school its own",
    body: "Onboard unlimited schools on a single, secure platform — every tenant fully isolated by row-level security. Add a new school in minutes, manage every tenant from one console.",
    checks: ["Per-tenant data isolation", "Central administration", "Each school its own subdomain"],
  },
  {
    key: "roles",
    icon: lock,
    tab: "Role-based access",
    title: "Everyone sees exactly their own job",
    body: "Owners, principals, bursars, admissions officers, teachers, parents and students each get their own view. Access is enforced at the database layer.",
    checks: ["Eight built-in roles", "Enforced by row-level security", "One person can hold more than one"],
  },
  {
    key: "notifications",
    icon: bell,
    tab: "Real-time alerts",
    title: "Nobody has to go looking for news",
    body: "An offer, a status change, a new invoice, a graded result — the right person is notified the moment it happens, in-app, without refreshing.",
    checks: ["Delivered the instant it happens", "Scoped to the right person", "Read state tracked"],
  },
  {
    key: "documents",
    icon: fileText,
    tab: "Document verification",
    title: "Original documents, checked once, trusted after",
    body: "Staff record exactly which original documents they've sighted — WAEC certificates, birth certificates — with who checked it and when.",
    checks: ["Timestamped sighting log", "Remarks per document", "Nothing lost in a filing cabinet"],
  },
  {
    key: "clearance",
    icon: checkCircle,
    tab: "Clearance workflow",
    title: "Nobody enrols until every department signs off",
    body: "Name your own clearance departments — Bursary, Library, Hostel — and an applicant can't be registered as a student until every one of them has cleared.",
    checks: ["Departments you define", "Enforced in the database", "Skips automatically if none set"],
  },
  {
    key: "audit",
    icon: search,
    tab: "Audit trail",
    title: "Every action, accounted for",
    body: "Who did what, when, and from where — a full audit trail across admissions, bursary, teaching and every role in between.",
    checks: ["Every change logged automatically", "Actor, time and detail attached", "On from day one"],
  },
  {
    key: "payments",
    icon: creditCard,
    tab: "Online + manual payments",
    title: "However your parents actually pay",
    body: "Take payments through an online gateway, or record cash and bank transfers manually — either way, an invoice updates the moment it's settled.",
    checks: ["Gateway, manual or automatic", "Line-item invoices", "Acceptance fees and tuition alike"],
  },
  {
    key: "grading",
    icon: cpu,
    tab: "Auto-grading",
    title: "Objective questions grade themselves",
    body: "MCQ and short-answer questions are graded the moment an exam is submitted — with image-based questions and a real scientific calculator.",
    checks: ["Instant objective scoring", "Proctoring events logged", "Teachers focus on what needs a human"],
  },
  {
    key: "protocols",
    icon: settings,
    tab: "Configurable protocols",
    title: "Your school's rules, not a fixed template",
    body: "Every protocol — fees, required documents, screening steps, clearance departments, programmes — is set by your own staff. No code, no developer.",
    checks: ["Set once, enforced automatically", "Every school can differ", "Change it yourselves, any time"],
  },
];

const CONFIG_TOGGLES = [
  ["Charge an application fee", true],
  ["Require an interview", false],
  ["Require referees", false],
  ["Require next of kin details", true],
  ["Allow anonymous applications", true],
];

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    tagline: "For a single school finding its feet online.",
    price: "₦450,000",
    period: "/month",
    note: "Billed monthly · up to 200 students",
    features: [
      "Admissions, from application to enrolment",
      "Fees — invoices, online and manual payment",
      "Report cards and result sheets",
      "Up to 3 staff accounts",
    ],
    cta: { label: "Start free trial", to: "/Start-Trial" },
  },
  {
    key: "growth",
    name: "Growth",
    tagline: "For a school running its whole year on one platform.",
    price: "₦950,000",
    period: "/month",
    note: "Billed monthly · up to 800 students",
    features: [
      "Everything in Starter",
      "Exams — auto-graded, with proctoring",
      "Configurable clearance departments",
      "Full audit trail across every role",
      "Unlimited staff accounts",
    ],
    cta: { label: "Start free trial", to: "/Start-Trial" },
    badge: "Most popular",
    highlighted: true,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    tagline: "For a group of schools, or one that has outgrown a plan.",
    price: "Custom",
    period: "",
    note: "Volume pricing across multiple schools",
    features: [
      "Everything in Growth",
      "Unlimited students",
      "Schoolivio Chat — messaging across your whole tenant",
      "Schoolivio Meet — built-in video conferencing",
      "Dedicated onboarding",
      "Priority support",
    ],
    cta: { label: "Book a demo", href: "mailto:hello@schoolivio.com" },
  },
];

/* ── Navigation ─────────────────────────────────────────────────────────── */
const Nav = () => {
  const [loginOpen, setLoginOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState("");

  const goToLogin = async (e) => {
    e.preventDefault();
    if (!slug.trim() || checking) return;
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!clean) return;
    setChecking(true);
    setNotFound("");
    const { data, error } = await supabase.rpc("public_school", { target_slug: clean });
    setChecking(false);
    if (error) { setNotFound("Could not check that right now — please try again."); return; }
    if (!data?.length) {
      setNotFound(`We couldn't find a school at "${clean}.schoolivio.com" — check the address your school gave you.`);
      return;
    }
    const { protocol, hostname, port } = window.location;
    const parts = hostname.toLowerCase().split(".");
    const base = hostname.endsWith("localhost") || hostname === "localhost"
      ? "localhost" : parts.slice(-2).join(".");
    window.location.href = `${protocol}//${clean}.${base}${port ? `:${port}` : ""}/Login`;
  };

  return (
    <div className="mkt-nav-wrap">
      <header className="mkt-nav">
        <Link to="/" className="mkt-nav-logo">
          <Mark size={22} />{"Schoolivio"}
        </Link>

        <nav className="mkt-nav-links">
          <div className="mkt-nav-dd">
            <button type="button" className="mkt-nav-link">
              {"Product"}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mkt-nav-dd-chevron">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div className="mkt-nav-dd-panel">
              <div className="mkt-nav-dd-card">
                <a href="#product" className="mkt-nav-dd-item">
                  <span className="mkt-nav-dd-icon purple"><Icon icon={grid} size={14} /></span>
                  <span>
                    <span className="mkt-nav-dd-title">{"Features"}</span>
                    <span className="mkt-nav-dd-desc">{"Everyday tools your school uses"}</span>
                  </span>
                </a>
                <a href="#capabilities" className="mkt-nav-dd-item">
                  <span className="mkt-nav-dd-icon blue"><Icon icon={layers} size={14} /></span>
                  <span>
                    <span className="mkt-nav-dd-title">{"Capabilities"}</span>
                    <span className="mkt-nav-dd-desc">{"What makes the platform different"}</span>
                  </span>
                </a>
              </div>
            </div>
          </div>
          <a href="#configure" className="mkt-nav-link">{"Configure it your way"}</a>
          <a href="#pricing" className="mkt-nav-link">{"Pricing"}</a>
        </nav>

        <span className="mkt-nav-spacer" />

        <span className="mkt-nav-actions">
          {loginOpen ? (
            <div className="mkt-nav-slug-wrap">
              <form onSubmit={goToLogin} className="mkt-nav-slug-form">
                <input
                  autoFocus
                  placeholder="your-school"
                  value={slug}
                  onChange={(e) => { setSlug(e.target.value); if (notFound) setNotFound(""); }}
                  className="mkt-nav-slug-input"
                  aria-invalid={notFound ? "true" : undefined}
                />
                <span className="mkt-nav-slug-suffix">{".schoolivio.com"}</span>
                <button type="submit" className="mkt-btn mkt-btn-ghost-light mkt-btn-sm" disabled={checking}>
                  {checking ? "Checking…" : "Go"}
                </button>
              </form>
              {notFound ? <p className="mkt-nav-slug-error" role="alert">{notFound}</p> : null}
            </div>
          ) : (
            <a href="#login" className="mkt-nav-textlink"
              onClick={(e) => { e.preventDefault(); setLoginOpen(true); }}>
              {"Log in"}
              <svg viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true" className="mkt-nav-underline">
                <path d="M2 9 C 20 3, 35 12, 50 7 C 65 2, 80 11, 98 5" fill="none" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </a>
          )}
          <Link to="/Start-Trial" className="mkt-nav-cta">{"Get started"}</Link>
        </span>
      </header>
    </div>
  );
};

/* ── Hero ────────────────────────────────────────────────────────────────── */
const AUTO_ADVANCE_MS = 4500;

const Hero = () => {
  const [active, setActive] = useState(0);
  const timerRef = useRef(null);

  const restart = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setActive((i) => (i + 1) % MODULES.length), AUTO_ADVANCE_MS);
  };
  useEffect(() => { restart(); return () => clearInterval(timerRef.current); }, []); // eslint-disable-line

  const select = (i) => { setActive(i); restart(); };
  const mod = MODULES[active];

  return (
    <section className="mkt-hero">
      <div className="mkt-hero-blob" aria-hidden="true" />
      <div className="mkt-wrap">
        {/* Eyebrow chip */}
        <div className="mkt-reveal" style={{ textAlign: "center" }}>
          <span className="mkt-chip">
            <span className="mkt-chip-icon" aria-hidden="true"><Icon icon={zap} size={11} /></span>
            <span className="mkt-chip-label">{"School operations, simplified"}</span>
          </span>

          <h1>
            {"Run your entire school year in "}
            <span className="mkt-underline-wrap">
              {"one calm workspace"}
              <HandDrawnUnderline color="#7c4fe0" />
            </span>
          </h1>

          <p className="mkt-hero-sub">
            {"Admissions, fees, exams and results in one place — built for how your school actually runs, not the other way round."}
          </p>

          <div className="mkt-hero-ctas">
            <Link to="/Start-Trial" className="mkt-btn mkt-btn-primary">
              {"Get started — for free"}
              <span style={{ fontSize: 13 }}>→</span>
            </Link>
            <a href="mailto:hello@schoolivio.com" className="mkt-btn mkt-btn-ghost-light">
              {"Book a demo"}
            </a>
          </div>
          <p className="mkt-hero-fine">{"45-day free trial · No credit card required · Configure it your way from day one"}</p>
        </div>

        {/* Mockup + floating stat cards */}
        <div className="mkt-hero-mockup-area">
          {/* Floating stat cards */}
          <div className="mkt-stat-card yellow d1 mkt-sc-1 mkt-reveal" style={{ animationPlayState: "running" }}>
            <div className="mkt-stat-card-icon"><Icon icon={clock} size={18} /></div>
            <div className="mkt-stat-card-value">{"3 min"}</div>
            <div className="mkt-stat-card-label">{"Average offer turnaround"}</div>
          </div>

          <div className="mkt-stat-card d2 mkt-sc-2 mkt-reveal" style={{ animationPlayState: "running" }}>
            <div style={{
              position: "relative", width: 64, height: 64, borderRadius: 12,
              background: "#e7deff", display: "flex", alignItems: "center",
              justifyContent: "center", marginBottom: 10,
            }}>
              <Icon icon={award} size={26} />
              <span style={{
                position: "absolute", top: 4, right: 4, width: 10, height: 10,
                borderRadius: "50%", background: "#7c4fe0", border: "2px solid #fff",
              }} />
            </div>
            <div className="mkt-stat-card-value" style={{ fontSize: 15 }}>{"Offer accepted"}</div>
            <div className="mkt-stat-card-label">{"JAN/2026/0041 · just now"}</div>
          </div>

          <div className="mkt-notif-card mkt-sc-3 mkt-reveal" style={{ animationPlayState: "running" }}>
            <div className="mkt-notif-icon">
              <Icon icon={user} size={14} />
              <span className="mkt-notif-dot" />
            </div>
            <div>
              <div className="mkt-notif-text">{"New parent registered on portal"}</div>
              <span className="mkt-notif-action">{"View profile"}</span>
            </div>
          </div>

          <div className="mkt-stat-card brand d4 mkt-sc-4 mkt-reveal" style={{ animationPlayState: "running" }}>
            <div className="mkt-stat-card-icon"><Icon icon={check} size={18} /></div>
            <div className="mkt-stat-card-value white">{"100%"}</div>
            <div className="mkt-stat-card-label white">{"Actions logged to audit trail"}</div>
          </div>

          {/* Product mockup */}
          <div className="mkt-mock-wrap mkt-reveal" style={{ transitionDelay: ".1s" }}>
            <div className="mkt-mock">
              <div className="mkt-mock-inner">
                <div className="mkt-mock-bar">
                  <span className="mkt-mock-dot" />
                  <span className="mkt-mock-dot" />
                  <span className="mkt-mock-dot" />
                </div>
                <div className="mkt-mock-body">
                  <div className="mkt-mock-side">
                    {MODULES.map((m, i) => (
                      <button
                        key={m.key} type="button"
                        className={`mkt-mock-side-item${i === active ? " on" : ""}`}
                        onClick={() => select(i)}
                      >
                        <span className="mkt-mock-side-icon"><Icon icon={m.icon} size={12} /></span>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div className="mkt-mock-main" key={mod.key}>
                    <div className="mkt-mock-eyebrow">{mod.eyebrow}</div>
                    <div className="mkt-mock-title">{mod.title}</div>
                    <div className="mkt-mock-stats">
                      {mod.stats.map((s) => (
                        <div className="mkt-mock-stat" key={s.label}>
                          <b>{s.value}</b><span>{s.label}</span>
                        </div>
                      ))}
                    </div>
                    {mod.rows.map((r) => (
                      <div className="mkt-mock-row" key={r.text}>
                        <span style={{ fontSize: 8 }}>{r.text}</span>
                        <span className={`mkt-mock-badge ${r.tone}`}>{r.badge}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ── Customer Strip ─────────────────────────────────────────────────────── */
// eslint-disable-next-line no-unused-vars
const CustomerStrip = () => (
  <section className="mkt-strip">
    <div className="mkt-wrap">
      <p className="mkt-strip-eyebrow mkt-reveal">{"Trusted by ambitious schools"}</p>
      <div className="mkt-strip-logos">
        {SCHOOL_NAMES.map(({ name, style }, i) => (
          <span
            key={name}
            className={`mkt-strip-name mkt-reveal d${Math.min(i + 1, 5)} ${style.split(" ").map(s => `mkt-strip-name--${s}`).join(" ")}`}
            style={{
              fontStyle: style.includes("serif") ? "italic" : "normal",
              fontSize: style.includes("lg") ? 15 : 13,
            }}
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  </section>
);

/* ── Stats ──────────────────────────────────────────────────────────────── */
const Stats = () => (
  <section className="mkt-stats">
    <div className="mkt-wrap">
      <div className="mkt-stats-grid">
        {STATS.map((s, i) => (
          <div key={s.label} className={`mkt-stats-cell mkt-reveal d${i + 1}`}>
            <div className="mkt-stats-value">{s.value}</div>
            <div className="mkt-stats-label">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ── Features ───────────────────────────────────────────────────────────── */
const Features = () => (
  <section className="mkt-section off-white" id="product">
    <div className="mkt-wrap">
      <div className="mkt-reveal" style={{ textAlign: "center", maxWidth: 650, margin: "0 auto 56px" }}>
        <div className="mkt-eyebrow">{"ONE PLATFORM"}</div>
        <h2 className="mkt-h2" style={{ maxWidth: 560, margin: "0 auto 20px" }}>
          {"The stack your staff "}
          <span className="mkt-underline-wrap">
            {"actually use"}
            <HandDrawnUnderline color="#7c4fe0" />
          </span>
        </h2>
        <p className="mkt-lede" style={{ margin: "0 auto" }}>
          {"Everything a school office needs, with none of the clutter that makes enterprise school software painful."}
        </p>
      </div>
      <div className="mkt-grid">
        {FEATURES.map((f, i) => (
          <div className={`mkt-card mkt-reveal d${(i % 3) + 1}`} key={f.title}>
            <div className={`mkt-card-icon ${f.accent}`}><Icon icon={f.icon} size={18} /></div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ── Capabilities ───────────────────────────────────────────────────────── */
const Capabilities = () => {
  const [active, setActive] = useState(0);
  const timerRef = useRef(null);

  const restart = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setActive((i) => (i + 1) % CAPABILITIES.length), AUTO_ADVANCE_MS + 500);
  };
  useEffect(() => { restart(); return () => clearInterval(timerRef.current); }, []); // eslint-disable-line

  const select = (i) => { setActive(i); restart(); };
  const cap = CAPABILITIES[active];

  return (
    <section className="mkt-cap-section" id="capabilities">
      <div className="mkt-wrap">
        <div className="mkt-reveal" style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 56px" }}>
          <div className="mkt-eyebrow">{"CAPABILITIES"}</div>
          <h2 className="mkt-h2" style={{ maxWidth: 560, margin: "0 auto 20px" }}>
            {"Built for how schools "}
            <span className="mkt-underline-wrap">
              {"actually run"}
              <HandDrawnUnderline color="#7c4fe0" />
            </span>
          </h2>
          <p className="mkt-lede" style={{ margin: "0 auto" }}>
            {"The platform advantages that make Schoolivio different — explore what's built in."}
          </p>
        </div>

        <div className="mkt-cap-layout mkt-reveal">
          {/* Tab rail */}
          <div className="mkt-cap-rail" role="tablist" aria-label="Platform capabilities">
            {CAPABILITIES.map((c, i) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={i === active}
                className={`mkt-cap-btn${i === active ? " active" : ""}`}
                onClick={() => select(i)}
              >
                <span className="mkt-cap-btn-icon"><Icon icon={c.icon} size={14} /></span>
                {c.tab}
              </button>
            ))}
          </div>

          {/* Dark preview panel */}
          <div className="mkt-cap-panel" key={cap.key}>
            <span className="mkt-cap-count">
              {String(active + 1).padStart(2, "0")}{" / "}{String(CAPABILITIES.length).padStart(2, "0")}
            </span>
            <div className="mkt-cap-icon-wrap"><Icon icon={cap.icon} size={22} /></div>
            <h3>{cap.title}</h3>
            <p>{cap.body}</p>
            <div className="mkt-cap-checks">
              {cap.checks.map((c) => <span className="mkt-cap-check" key={c}>{c}</span>)}
            </div>
            <div className="mkt-cap-panel-ctas">
              <Link to="/Start-Trial" className="mkt-btn mkt-btn-primary">{"Start free trial"}</Link>
              <a href="mailto:hello@schoolivio.com" className="mkt-btn mkt-btn-ghost-dark">{"Request a demo"}</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ── Configure Section ──────────────────────────────────────────────────── */
const ConfigureSection = () => {
  const [toggles, setToggles] = useState(() => Object.fromEntries(CONFIG_TOGGLES));
  const flip = (label) => setToggles((c) => ({ ...c, [label]: !c[label] }));

  return (
    <section className="mkt-configure" id="configure">
      <div className="mkt-wrap">
        <div className="mkt-split">
          <div className="mkt-reveal">
            <span style={{
              display: "inline-flex", borderRadius: 999,
              background: "#e7deff", padding: "6px 14px",
              fontSize: 9, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: ".13em", color: "rgba(17,17,17,.55)",
              marginBottom: 20,
            }}>
              {"No code, no developer"}
            </span>
            <h2 className="mkt-h2" style={{ maxWidth: 480 }}>
              {"Your school, "}
              <span className="mkt-underline-wrap">
                {"your rules"}
                <HandDrawnUnderline color="#7c4fe0" />
              </span>
            </h2>
            <p className="mkt-lede" style={{ maxWidth: 440, margin: "0 0 28px" }}>
              {"Your administrator configures every protocol from School administration — fees, documents, clearance departments, programmes — set up once, enforced automatically."}
            </p>
            <ul className="mkt-checklist">
              {[
                "Turn fees on or off, per session",
                "Add your own screening steps and required documents",
                "Name your own clearance departments — Bursary, Library, Hostel",
                "Choose manual, gateway or automatic payment verification",
              ].map((item) => (
                <li key={item}>
                  <span className="mkt-check-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#36794f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="mkt-configure-card mkt-reveal" style={{ transitionDelay: ".1s" }}>
            <div className="mkt-configure-card-header">{"Admissions settings"}</div>
            <div className="mkt-configure-card-body">
              {CONFIG_TOGGLES.map(([label]) => {
                const on = toggles[label];
                return (
                  <div key={label} className="mkt-configure-row">
                    <span style={{ fontSize: 13 }}>{label}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={label}
                      onClick={() => flip(label)}
                      className="mkt-toggle-switch"
                      style={{ background: on ? "#7c4fe0" : "#e0daf7" }}
                    >
                      <span className="mkt-toggle-knob" style={{ left: on ? 16 : 2 }} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ── Pricing ────────────────────────────────────────────────────────────── */
const Pricing = () => (
  <section className="mkt-pricing" id="pricing">
    <div className="mkt-wrap">
      <div className="mkt-reveal" style={{ marginBottom: 52 }}>
        <div className="mkt-eyebrow">{"PRICING"}</div>
        <h2 className="mkt-h2">{"Simple pricing, one platform"}</h2>
        <p className="mkt-lede">
          {"Every plan includes the full platform — admissions, fees, exams, results and the audit trail. Pricing scales with how many students you run it for."}
        </p>
      </div>
      <div className="mkt-pricing-grid">
        {PLANS.map((p, i) => (
          <div className={`mkt-pricing-card mkt-reveal d${i + 1}${p.highlighted ? " highlighted" : ""}`} key={p.key}>
            {p.badge ? <span className="mkt-pricing-badge">{p.badge}</span> : null}
            <div className="mkt-pricing-name">{p.name}</div>
            <p className="mkt-pricing-tagline">{p.tagline}</p>
            <div className="mkt-pricing-price">
              {p.price}
              {p.period ? <span>{p.period}</span> : null}
            </div>
            <p className="mkt-pricing-note">{p.note}</p>
            <ul className="mkt-pricing-features">
              {p.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
            {p.cta.to ? (
              <Link to={p.cta.to} className={`mkt-btn ${p.highlighted ? "mkt-btn-primary" : "mkt-btn-ghost-light"} mkt-btn-block`} style={{ justifyContent: "center" }}>
                {p.cta.label}
              </Link>
            ) : (
              <a href={p.cta.href} className={`mkt-btn ${p.highlighted ? "mkt-btn-primary" : "mkt-btn-ghost-light"} mkt-btn-block`} style={{ justifyContent: "center" }}>
                {p.cta.label}
              </a>
            )}
          </div>
        ))}
      </div>
      <p className="mkt-pricing-fine">{"Illustrative pricing — tell us about your school and we'll confirm what's right for you."}</p>
    </div>
  </section>
);

/* ── Final CTA ──────────────────────────────────────────────────────────── */
const FinalCta = () => (
  <section className="mkt-final-outer">
    <div className="mkt-wrap">
      <div className="mkt-final-card mkt-reveal">
        <div className="mkt-final-left">
          <div className="mkt-final-eyebrow">
            <span className="mkt-final-eyebrow-dot" />
            {"Start today"}
          </div>

          <h2 className="mkt-final-h2">
            {"One "}
            <span className="mkt-underline-wrap">
              {"calm workspace"}
              <HandDrawnUnderline color="#7c4fe0" />
            </span>
            {" for your whole year"}
          </h2>

          <p className="mkt-final-sub">
            {"Create your school's workspace and start bringing admissions, fees, exams and results together."}
          </p>

          <ul className="mkt-final-bullets">
            {[
              ["45-day free trial", "y"],
              ["No credit card",    "lv"],
              ["Setup in minutes",  "g"],
            ].map(([label, tone]) => (
              <li key={label} className="mkt-final-bullet">
                <span className={`mkt-final-bullet-dot ${tone}`} />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="mkt-final-right">
          <p className="mkt-final-right-label">{"Ready when you are"}</p>
          <p className="mkt-final-right-sub">
            {"Create your workspace and start bringing your school operations together."}
          </p>
          <div className="mkt-final-cta-stack">
            <Link to="/Start-Trial" className="mkt-btn-dark-primary">
              <span>{"Start free trial"}</span>
              <span className="mkt-btn-dark-primary-arrow">{"→"}</span>
            </Link>
            <a href="mailto:hello@schoolivio.com" className="mkt-btn mkt-btn-ghost-dark">
              {"Book a personalised demo"}
            </a>
          </div>
          <p className="mkt-final-fine">
            {"No long-term commitment. 45 days free — talk to our team whenever you need help getting started."}
          </p>
        </div>
      </div>
    </div>
  </section>
);

/* ── Footer ─────────────────────────────────────────────────────────────── */
const Footer = () => (
  <footer className="mkt-footer">
    <div className="mkt-wrap mkt-footer-top">
      <div className="mkt-footer-brand">
        <span className="mkt-footer-logo"><Mark size={22} />{"Schoolivio"}</span>
        <p className="mkt-footer-tagline">
          {"Admissions, fees, exams and results — one calm workspace for the whole school year."}
        </p>
      </div>
      <div className="mkt-footer-cols">
        <div className="mkt-footer-col">
          <p className="mkt-footer-col-label">{"Product"}</p>
          <a href="#product">{"Features"}</a>
          <a href="#capabilities">{"Capabilities"}</a>
          <a href="#configure">{"Configure it your way"}</a>
          <a href="#pricing">{"Pricing"}</a>
        </div>
        <div className="mkt-footer-col">
          <p className="mkt-footer-col-label">{"Company"}</p>
          <a href="mailto:hello@schoolivio.com">{"Contact"}</a>
          <Link to="/Start-Trial">{"Start free trial"}</Link>
        </div>
      </div>
    </div>
    <div className="mkt-wrap mkt-footer-bottom">
      <span>{`© ${new Date().getFullYear()} Schoolivio. All rights reserved.`}</span>
      <span>{"Built for schools that want one calm place to run their year."}</span>
      <a className="mkt-footer-tekktopia" href="https://tekktopia.com" target="_blank" rel="noopener noreferrer">
        <img src="/brand/tekktopia-logo.png" alt="Tekktopia" width="28" height="28" />
        {"A product of Tekktopia Limited"}
      </a>
    </div>
  </footer>
);

/* ── Landing ────────────────────────────────────────────────────────────── */
const Landing = () => {
  useReveal();
  return (
  <div className="mkt">
    <Nav />
    <Hero />
    {/* <CustomerStrip /> */}
    <Stats />
    <Features />
    <Capabilities />
    <ConfigureSection />
    <Pricing />
    <FinalCta />
    <Footer />
  </div>
  );
};

export default Landing;
