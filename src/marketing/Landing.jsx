import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { Mark } from "../Components/Logo";

// The hero's little "app window" — clickable modules on the left, content on
// the right that swaps on click and also advances on its own every few
// seconds, the way a product demo would if someone were narrating it.
const MODULES = [
  {
    key: "dashboard",
    label: "Dashboard",
    title: "Good morning, Jane-Nath College",
    stats: [
      { value: "612", label: "Students enrolled" },
      { value: "38", label: "Staff on the roster" },
      { value: "5", label: "Notices this week" },
      { value: "3", label: "Approvals waiting" },
    ],
    rows: [
      { text: "Term 2 report cards — approval pending", tone: "y", badge: "Review" },
      { text: "New staff invite accepted — B. Oni", tone: "g", badge: "Done" },
      { text: "Library clearance backlog — 2 pupils", tone: "p", badge: "Attention" },
    ],
  },
  {
    key: "admissions",
    label: "Admissions",
    title: "Admissions workspace",
    stats: [
      { value: "18", label: "Awaiting decision" },
      { value: "6", label: "Clearance in progress" },
      { value: "92%", label: "Fees reconciled" },
      { value: "4", label: "New today" },
    ],
    rows: [
      { text: "JAN/2026/0041 — offer accepted", tone: "g", badge: "Cleared" },
      { text: "JAN/2026/0039 — awaiting acceptance fee", tone: "y", badge: "Pending" },
      { text: "JAN/2026/0037 — screening complete", tone: "p", badge: "In review" },
    ],
  },
  {
    key: "bursary",
    label: "Bursary",
    title: "Fees this term",
    stats: [
      { value: "₦15.3M", label: "Invoiced" },
      { value: "₦11.0M", label: "Collected" },
      { value: "71.9%", label: "Collection rate" },
      { value: "9", label: "Invoices overdue" },
    ],
    rows: [
      { text: "JNC/INV/0182 — payment confirmed", tone: "g", badge: "Paid" },
      { text: "JNC/INV/0179 — reminder sent", tone: "y", badge: "Due soon" },
      { text: "JNC/INV/0175 — 14 days overdue", tone: "p", badge: "Overdue" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    title: "Result sheets — Third term",
    stats: [
      { value: "9", label: "Classes reported" },
      { value: "2", label: "Awaiting approval" },
      { value: "76%", label: "Average pass rate" },
      { value: "412", label: "Report cards issued" },
    ],
    rows: [
      { text: "JSS 2 — result sheet approved", tone: "g", badge: "Released" },
      { text: "SS 1 — awaiting principal sign-off", tone: "y", badge: "Pending" },
      { text: "JSS 3 — grading in progress", tone: "p", badge: "In review" },
    ],
  },
  {
    key: "school",
    label: "School",
    title: "School administration",
    stats: [
      { value: "12", label: "Classes configured" },
      { value: "3", label: "Clearance departments" },
      { value: "8", label: "Admin & staff roles" },
      { value: "1", label: "Active session" },
    ],
    rows: [
      { text: "New clearance department — Hostel", tone: "g", badge: "Added" },
      { text: "Admissions officer invited — J. Daniyo", tone: "y", badge: "Pending" },
      { text: "Academic calendar updated for 2026/2027", tone: "p", badge: "Saved" },
    ],
  },
];

const FEATURES = [
  {
    icon: "🗂️",
    title: "One dashboard for the whole school",
    body: "Admissions, teaching, fees, exams and results in a single workspace — nobody switches between five different tools to run one school day.",
  },
  {
    icon: "📝",
    title: "Admissions, start to finish",
    body: "Application → screening → offer → acceptance fee → clearance → enrolment, each step tracked and gated automatically, right through to the admission letter.",
  },
  {
    icon: "💳",
    title: "Fees parents actually understand",
    body: "Line-item invoices, plain-language payment status, online or manual payment — never just a wall of numbers a parent has to decode.",
  },
  {
    icon: "🖩",
    title: "Exams built for the room",
    body: "MCQ and short-answer auto-grading, image-based questions, a real scientific calculator when a subject needs one, and proctoring events logged as they happen.",
  },
  {
    icon: "📊",
    title: "Results without the spreadsheet chase",
    body: "Result sheets, an approval workflow before anything is released, and report cards a parent can actually read.",
  },
  {
    icon: "🔍",
    title: "Every action, accounted for",
    body: "Who did what, when, and from where — a full audit trail across admissions, bursary, teaching and every role in between.",
  },
];

// The capabilities band's clickable module rail — one at a time, click or
// auto-advance swaps the panel beside it. Same interaction as the hero mock,
// applied to what makes the platform itself different rather than the
// day-to-day workspace.
const CAPABILITIES = [
  {
    key: "multitenant",
    icon: "🏫",
    label: "Multi-tenant",
    title: "One platform, every school its own",
    body: "Onboard unlimited schools on a single, secure platform — every tenant fully isolated by row-level security, right down to who can read a single invoice. Add a new school in minutes, manage every tenant's plan and access from one console.",
    checks: ["Per-tenant data isolation", "Central administration", "Each school its own subdomain"],
  },
  {
    key: "roles",
    icon: "🔐",
    label: "Role-based access",
    title: "Everyone sees exactly their own job",
    body: "Owners, principals, bursars, admissions officers, teachers, parents and students each get their own view — nothing more. Access is enforced at the database layer, not just hidden in the interface.",
    checks: ["Eight built-in roles", "Enforced by row-level security", "One person can hold more than one"],
  },
  {
    key: "notifications",
    icon: "🔔",
    label: "Real-time notifications",
    title: "Nobody has to go looking for news",
    body: "An offer, a status change, a new invoice, a graded result — the right person is notified the moment it happens, in-app, without refreshing or digging through menus.",
    checks: ["Delivered the instant it happens", "Scoped to the right person", "Read state tracked"],
  },
  {
    key: "documents",
    icon: "📄",
    label: "Document verification",
    title: "Original documents, checked once, trusted after",
    body: "Staff record exactly which original documents they've physically sighted — WAEC certificates, birth certificates, whatever your school requires — with who checked it and when.",
    checks: ["Timestamped sighting log", "Remarks per document", "Nothing lost in a filing cabinet"],
  },
  {
    key: "clearance",
    icon: "✅",
    label: "Clearance workflow",
    title: "Nobody enrols until every department signs off",
    body: "Name your own clearance departments — Bursary, Library, Hostel, whatever your school runs — and an applicant can't be registered as a student until every one of them has cleared.",
    checks: ["Departments you define", "Enforced in the database", "Skips automatically if none are set"],
  },
  {
    key: "audit",
    icon: "🔍",
    label: "Audit trail",
    title: "Every action, accounted for",
    body: "Who did what, when, and from where — a full audit trail across admissions, bursary, teaching and every role in between, visible to the people who need to answer for it.",
    checks: ["Every change logged automatically", "Actor, time and detail attached", "On from day one"],
  },
  {
    key: "payments",
    icon: "💳",
    label: "Online + manual payments",
    title: "However your parents actually pay",
    body: "Take payments through an online gateway, or record cash and bank transfers manually — either way, an invoice's status updates the moment it's settled, with nothing left ambiguous.",
    checks: ["Gateway, manual or automatic", "Line-item invoices", "Acceptance fees and tuition alike"],
  },
  {
    key: "grading",
    icon: "🖩",
    label: "Auto-grading",
    title: "Objective questions grade themselves",
    body: "MCQ and short-answer questions are graded the moment an exam is submitted — with image-based questions and a real scientific calculator for the subjects that need one.",
    checks: ["Instant objective scoring", "Proctoring events logged", "Teachers focus on what needs a human"],
  },
  {
    key: "protocols",
    icon: "⚙️",
    label: "Configurable protocols",
    title: "Your school's rules, not a fixed template",
    body: "Every protocol — fees, required documents, screening steps, clearance departments, programmes — is set from School administration by your own staff. No code, no developer, no ticket to file.",
    checks: ["Set once, enforced automatically", "Every school can differ", "Change it yourselves, any time"],
  },
];

// Placeholder figures — swap these for the school's real numbers whenever
// they're settled; the point of building this section now is the layout
// and the copy pattern, not these specific naira amounts.
const PLANS = [
  {
    key: "starter",
    name: "Starter",
    tagline: "For a single school finding its feet online.",
    price: "₦25,000",
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
    price: "₦65,000",
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
      "Dedicated onboarding",
      "Priority support",
    ],
    cta: { label: "Book a demo", href: "mailto:hello@schoolivio.com" },
  },
];

const Pricing = () => (
  <section className="mkt-section" id="pricing">
    <div className="mkt-wrap">
      <div className="mkt-eyebrow">{"PRICING"}</div>
      <h2 className="mkt-h2">{"Simple pricing that grows with your school"}</h2>
      <p className="mkt-lede">
        {"Every plan includes the full platform — admissions, fees, exams, results and the audit trail behind them. Pricing scales with how many students you run it for, not which features you're allowed to use."}
      </p>
      <div className="mkt-pricing-grid">
        {PLANS.map((p) => (
          <div className={`mkt-pricing-card${p.highlighted ? " highlighted" : ""}`} key={p.key}>
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
              <Link to={p.cta.to} className={`mkt-btn ${p.highlighted ? "mkt-btn-primary" : "mkt-btn-ghost-light"} mkt-btn-block`}>
                {p.cta.label}
              </Link>
            ) : (
              <a href={p.cta.href} className={`mkt-btn ${p.highlighted ? "mkt-btn-primary" : "mkt-btn-ghost-light"} mkt-btn-block`}>
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

const CONFIG_TOGGLES = [
  ["Charge an application fee", true],
  ["Require an interview", false],
  ["Require referees", false],
  ["Require next of kin details", true],
  ["Allow anonymous applications", true],
];

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
    // A wrong subdomain used to redirect straight there anyway — a visitor
    // only found out it was wrong once they tried to sign in and RLS turned
    // up nothing, which reads as "you don't have access" rather than "that
    // school doesn't exist". public_school() is already public precisely so
    // a login page can name its school before anyone signs in; checking it
    // here first means a typo never leaves the marketing site at all.
    const { data, error } = await supabase.rpc("public_school", { target_slug: clean });
    setChecking(false);

    if (error) {
      setNotFound("Could not check that right now — please try again.");
      return;
    }
    if (!data?.length) {
      setNotFound(`We couldn't find a school at "${clean}.schoolivio.com" — check the web address your school gave you.`);
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
          <Mark size={22} />
          {"Schoolivio"}
        </Link>

        <nav className="mkt-nav-links">
          <div className="mkt-nav-dd">
            <button type="button" className="mkt-nav-dd-trigger">
              {"Product"}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mkt-nav-dd-chevron">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div className="mkt-nav-dd-panel">
              <div className="mkt-nav-dd-card">
                <a href="#product" className="mkt-nav-dd-item">
                  <span className="mkt-nav-dd-icon a">{"🗂️"}</span>
                  <span>
                    <span className="mkt-nav-dd-title">{"Features"}</span>
                    <span className="mkt-nav-dd-desc">{"Everyday tools your school uses"}</span>
                  </span>
                </a>
                <a href="#capabilities" className="mkt-nav-dd-item">
                  <span className="mkt-nav-dd-icon b">{"🏫"}</span>
                  <span>
                    <span className="mkt-nav-dd-title">{"Capabilities"}</span>
                    <span className="mkt-nav-dd-desc">{"What makes the platform different"}</span>
                  </span>
                </a>
              </div>
            </div>
          </div>
          <a href="#configure">{"Configure it your way"}</a>
          <a href="#pricing">{"Pricing"}</a>
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
                  onChange={(e) => {
                    setSlug(e.target.value);
                    if (notFound) setNotFound("");
                  }}
                  className="mkt-nav-slug-input"
                  aria-invalid={notFound ? "true" : undefined}
                />
                <span className="mkt-nav-slug-suffix">{".schoolivio.com"}</span>
                <button type="submit" className="mkt-btn mkt-btn-ghost-light mkt-btn-sm" disabled={checking}>
                  {checking ? "Checking…" : "Go"}
                </button>
              </form>
              {notFound ? (
                <p className="mkt-nav-slug-error" role="alert">{notFound}</p>
              ) : null}
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
          <Link to="/Start-Trial" className="mkt-nav-cta">{"Start free trial"}</Link>
        </span>
      </header>
    </div>
  );
};

const AUTO_ADVANCE_MS = 4500;

const Hero = () => {
  const [active, setActive] = useState(0);
  const timerRef = useRef(null);

  const restart = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActive((i) => (i + 1) % MODULES.length);
    }, AUTO_ADVANCE_MS);
  };

  useEffect(() => {
    restart();
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (i) => {
    setActive(i);
    restart();
  };

  const mod = MODULES[active];

  return (
    <section className="mkt-hero">
      <div className="mkt-wrap">
        <span className="mkt-chip"><span className="mkt-chip-dot" />{"School operations, simplified"}</span>
        <h1>{"Run your entire school year in one calm workspace"}</h1>
        <p className="mkt-hero-sub">
          {"Admissions, fees, exams and results in one place — built for how your school actually runs, not the other way round."}
        </p>
        <div className="mkt-hero-cta">
          <Link to="/Start-Trial" className="mkt-btn mkt-btn-primary">{"Start free trial →"}</Link>
          <a href="mailto:hello@schoolivio.com" className="mkt-btn mkt-btn-ghost-dark">{"Book a demo"}</a>
        </div>
        <p className="mkt-hero-trust">{"15-day free trial · No credit card required · Configure it your way from day one"}</p>

        <div className="mkt-mock-wrap">
          <div className="mkt-float-chip mkt-float-1">
            <b>3 min</b>
            <span>Average time to issue an offer</span>
          </div>
          <div className="mkt-float-chip mkt-float-2">
            <b>100%</b>
            <span>Actions logged to the audit trail</span>
          </div>
          <div className="mkt-mock">
            <div className="mkt-mock-bar">
              <span className="mkt-mock-dot" /><span className="mkt-mock-dot" /><span className="mkt-mock-dot" />
            </div>
            <div className="mkt-mock-body">
              <div className="mkt-mock-side">
                {MODULES.map((m, i) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`mkt-mock-side-item${i === active ? " on" : ""}`}
                    onClick={() => select(i)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="mkt-mock-main" key={mod.key}>
                <div className="mkt-mock-title">{mod.title}</div>
                <div className="mkt-mock-stats">
                  {mod.stats.map((s) => (
                    <div className="mkt-mock-stat" key={s.label}><b>{s.value}</b><span>{s.label}</span></div>
                  ))}
                </div>
                {mod.rows.map((r) => (
                  <div className="mkt-mock-row" key={r.text}>
                    <span>{r.text}</span>
                    <span className={`mkt-mock-badge ${r.tone}`}>{r.badge}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const FeatureGrid = () => (
  <section className="mkt-section" id="product">
    <div className="mkt-wrap">
      <div className="mkt-eyebrow">{"ONE PLATFORM"}</div>
      <h2 className="mkt-h2">{"The school stack your staff actually want to use"}</h2>
      <p className="mkt-lede">{"Everything a school office needs, with none of the clutter that makes enterprise school software painful."}</p>
      <div className="mkt-grid">
        {FEATURES.map((f) => (
          <div className="mkt-card" key={f.title}>
            <div className="mkt-card-icon">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Capabilities = () => {
  const [active, setActive] = useState(0);
  const timerRef = useRef(null);

  const restart = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActive((i) => (i + 1) % CAPABILITIES.length);
    }, AUTO_ADVANCE_MS + 500);
  };

  useEffect(() => {
    restart();
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (i) => {
    setActive(i);
    restart();
  };

  const cap = CAPABILITIES[active];

  return (
    <section className="mkt-band" id="capabilities">
      <div className="mkt-wrap">
        <div className="mkt-eyebrow">{"CAPABILITIES"}</div>
        <h2 className="mkt-h2">{"Built for the way schools actually run"}</h2>
        <p className="mkt-lede">{"The platform advantages that make Schoolivio different — explore what's built in."}</p>

        <div className="mkt-cap-layout">
          <div className="mkt-cap-list">
            {CAPABILITIES.map((c, i) => (
              <button
                key={c.key}
                type="button"
                className={`mkt-cap-item${i === active ? " active" : ""}`}
                onClick={() => select(i)}
              >
                <span className="mkt-cap-dot" />
                <span className="mkt-cap-icon">{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>
          <div className="mkt-cap-panel" key={cap.key}>
            <div className="mkt-cap-panel-icon">{cap.icon}</div>
            <h3>{cap.title}</h3>
            <p>{cap.body}</p>
            <div className="mkt-cap-checks">
              {cap.checks.map((c) => <span className="mkt-cap-check" key={c}>{c}</span>)}
            </div>
            <div className="mkt-hero-cta" style={{ justifyContent: "flex-start", marginTop: 24 }}>
              <Link to="/Start-Trial" className="mkt-btn mkt-btn-primary">{"Start free trial"}</Link>
              <a href="mailto:hello@schoolivio.com" className="mkt-btn mkt-btn-ghost-dark">{"Request a demo"}</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const ConfigureSection = () => {
  // Just a mockup, not a real settings form — clicking a toggle here never
  // saves anything anywhere. It exists so the switches feel real to poke at
  // rather than looking like a screenshot glued into the page.
  const [toggles, setToggles] = useState(() => Object.fromEntries(CONFIG_TOGGLES));
  const flip = (label) => setToggles((current) => ({ ...current, [label]: !current[label] }));

  return (
  <section className="mkt-section" id="configure">
    <div className="mkt-wrap">
      <div className="mkt-eyebrow">{"NO CODE, NO DEVELOPER"}</div>
      <h2 className="mkt-h2">{"Not every school works the same way — so yours doesn't have to"}</h2>
      <p className="mkt-lede">
        {"Your school's own administrator configures every protocol from School administration: fees and payment rules, required documents, screening steps, clearance departments, programmes — set up once, enforced automatically from then on."}
      </p>
      <div className="mkt-feature-split">
        <div className="mkt-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 14 }}>
            {"Admissions settings"}
          </div>
          <div style={{ padding: "6px 20px 16px" }}>
            {CONFIG_TOGGLES.map(([label]) => {
              const on = toggles[label];
              return (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f2eefc", fontSize: 13.5 }}>
                <span>{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={label}
                  onClick={() => flip(label)}
                  style={{
                    width: 34, height: 19, borderRadius: 999, position: "relative", flex: "none",
                    background: on ? "#7c4fe0" : "#e4dffc", border: "none", padding: 0, cursor: "pointer",
                    transition: "background .15s",
                  }}
                >
                  <span style={{
                    position: "absolute", top: 2, width: 15, height: 15, borderRadius: "50%", background: "#fff",
                    left: on ? 17 : 2, transition: "left .15s",
                  }} />
                </button>
              </div>
              );
            })}
          </div>
        </div>
        <div>
          <ul className="mkt-feature-list" style={{ color: "#3a3450" }}>
            <li style={{ color: "#3a3450" }}>{"Turn application and acceptance fees on or off, per session"}</li>
            <li style={{ color: "#3a3450" }}>{"Add your own screening steps and required documents — none required by default"}</li>
            <li style={{ color: "#3a3450" }}>{"Name your own clearance departments — Bursary, Library, Hostel, whatever your school runs"}</li>
            <li style={{ color: "#3a3450" }}>{"Choose manual, gateway, or automatic payment verification"}</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
  );
};

const FinalCta = () => (
  <section className="mkt-final">
    <div className="mkt-wrap">
      <div className="mkt-eyebrow" style={{ color: "var(--mkt-brand-2)" }}>{"READY WHEN YOU ARE"}</div>
      <h2>{"Give your school a calmer place to run its year"}</h2>
      <p>{"Create your school's workspace and start bringing admissions, fees, exams and results together."}</p>
      <div className="mkt-hero-cta">
        <Link to="/Start-Trial" className="mkt-btn mkt-btn-primary">{"Start free trial"}</Link>
        <a href="mailto:hello@schoolivio.com" className="mkt-btn mkt-btn-ghost-dark">{"Book a personalised demo"}</a>
      </div>
      <p style={{ color: "rgba(255,255,255,.4)", fontSize: 13, marginTop: 22 }}>
        {"No long-term commitment. 15 days free, no card required."}
      </p>
    </div>
  </section>
);

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
    </div>
  </footer>
);

const Landing = () => (
  <div className="mkt">
    <Nav />
    <Hero />
    <FeatureGrid />
    <Capabilities />
    <ConfigureSection />
    <Pricing />
    <FinalCta />
    <Footer />
  </div>
);

export default Landing;
