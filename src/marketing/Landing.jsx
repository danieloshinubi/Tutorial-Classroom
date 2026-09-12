import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Mark } from "../Components/Logo";

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

const TAGS = [
  "Multi-tenant", "Role-based access", "Real-time notifications", "Document verification",
  "Clearance workflow", "Audit trail", "Online + manual payments", "Auto-grading", "Configurable protocols",
];

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

  const goToLogin = (e) => {
    e.preventDefault();
    if (!slug.trim()) return;
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const { protocol, hostname, port } = window.location;
    const parts = hostname.toLowerCase().split(".");
    const base = hostname.endsWith("localhost") || hostname === "localhost"
      ? "localhost" : parts.slice(-2).join(".");
    window.location.href = `${protocol}//${clean}.${base}${port ? `:${port}` : ""}/Login`;
  };

  return (
    <header className="mkt-nav">
      <div className="mkt-nav-row">
        <Link to="/" className="mkt-nav-logo">
          <Mark size={26} />
          {"Schoolivio"}
        </Link>
        <nav className="mkt-nav-links">
          <a href="#product">{"Product"}</a>
          <a href="#configure">{"Configure it your way"}</a>
          <a href="#pricing">{"Pricing"}</a>
        </nav>
        <span className="mkt-nav-spacer" />
        <span className="mkt-nav-actions">
          {loginOpen ? (
            <form onSubmit={goToLogin} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                autoFocus
                placeholder="your-school"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                style={{
                  padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,.25)",
                  background: "rgba(255,255,255,.08)", color: "#fff", fontSize: 13.5, width: 140,
                }}
              />
              <span style={{ color: "rgba(255,255,255,.5)", fontSize: 12.5 }}>{".schoolivio.com"}</span>
              <button type="submit" className="mkt-btn mkt-btn-ghost-dark mkt-btn-sm">{"Go"}</button>
            </form>
          ) : (
            <a href="#login" className="mkt-btn mkt-btn-ghost-dark mkt-btn-sm"
              onClick={(e) => { e.preventDefault(); setLoginOpen(true); }}>
              {"Log in"}
            </a>
          )}
          <Link to="/Start-Trial" className="mkt-btn mkt-btn-primary mkt-btn-sm">{"Start free trial"}</Link>
        </span>
      </div>
    </header>
  );
};

const Hero = () => (
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
              <div className="mkt-mock-side-item on">{"Dashboard"}</div>
              <div className="mkt-mock-side-item">{"Admissions"}</div>
              <div className="mkt-mock-side-item">{"Bursary"}</div>
              <div className="mkt-mock-side-item">{"Reports"}</div>
              <div className="mkt-mock-side-item">{"School"}</div>
            </div>
            <div className="mkt-mock-main">
              <div className="mkt-mock-title">{"Admissions workspace"}</div>
              <div className="mkt-mock-stats">
                <div className="mkt-mock-stat"><b>18</b><span>{"Awaiting decision"}</span></div>
                <div className="mkt-mock-stat"><b>6</b><span>{"Clearance in progress"}</span></div>
                <div className="mkt-mock-stat"><b>92%</b><span>{"Fees reconciled"}</span></div>
                <div className="mkt-mock-stat"><b>4</b><span>{"New today"}</span></div>
              </div>
              <div className="mkt-mock-row"><span>{"JAN/2026/0041 — offer accepted"}</span><span className="mkt-mock-badge g">{"Cleared"}</span></div>
              <div className="mkt-mock-row"><span>{"JAN/2026/0039 — awaiting acceptance fee"}</span><span className="mkt-mock-badge y">{"Pending"}</span></div>
              <div className="mkt-mock-row"><span>{"JAN/2026/0037 — screening complete"}</span><span className="mkt-mock-badge p">{"In review"}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

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

const Capabilities = () => (
  <section className="mkt-band">
    <div className="mkt-wrap">
      <div className="mkt-eyebrow">{"CAPABILITIES"}</div>
      <h2 className="mkt-h2">{"Built for the way schools actually run"}</h2>
      <p className="mkt-lede">{"The platform advantages that make Schoolivio different — explore what's built in."}</p>
      <div className="mkt-tagcloud">
        {TAGS.map((t) => <span className="mkt-tag" key={t}>{t}</span>)}
      </div>

      <div className="mkt-feature-split">
        <div>
          <h3 style={{ fontSize: 22, marginBottom: 10 }}>{"One platform, every school its own"}</h3>
          <p style={{ color: "rgba(255,255,255,.62)", fontSize: 15, lineHeight: 1.6, maxWidth: 480 }}>
            {"Onboard unlimited schools on a single, secure platform — every tenant fully isolated by row-level security, right down to who can read a single invoice. Add a new school in minutes, manage every tenant's plan and access from one console, without standing up new infrastructure or mixing up one school's records with another's."}
          </p>
          <ul className="mkt-feature-list">
            <li>{"Per-tenant data isolation, enforced in the database itself"}</li>
            <li>{"Each school's own subdomain, branding and academic calendar"}</li>
            <li>{"One console for platform operations, separate from every school"}</li>
          </ul>
        </div>
        <div className="mkt-omni-stats" style={{ display: "block" }}>
          <div className="mkt-settings-mock">
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.5)", marginBottom: 10 }}>{"jane-nath.schoolivio.com"}</div>
            <div className="mkt-toggle-row"><span>{"Bursary sees admission payments"}</span><span className="mkt-switch on" /></div>
            <div className="mkt-toggle-row"><span>{"Clearance: Library department"}</span><span className="mkt-switch on" /></div>
            <div className="mkt-toggle-row"><span>{"Require interview before offer"}</span><span className="mkt-switch off" /></div>
            <div className="mkt-toggle-row"><span>{"Audit log — full detail"}</span><span className="mkt-switch on" /></div>
          </div>
          <div className="mkt-settings-mock" style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.5)", marginBottom: 10 }}>{"a-different-school.schoolivio.com"}</div>
            <div className="mkt-toggle-row"><span>{"Bursary sees admission payments"}</span><span className="mkt-switch off" /></div>
            <div className="mkt-toggle-row"><span>{"Clearance: Hostel department"}</span><span className="mkt-switch on" /></div>
            <div className="mkt-toggle-row"><span>{"Require interview before offer"}</span><span className="mkt-switch on" /></div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const ConfigureSection = () => (
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
            {CONFIG_TOGGLES.map(([label, on]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f2eefc", fontSize: 13.5 }}>
                <span>{label}</span>
                <span style={{
                  width: 34, height: 19, borderRadius: 999, position: "relative", flex: "none",
                  background: on ? "#7c4fe0" : "#e4dffc",
                }}>
                  <span style={{
                    position: "absolute", top: 2, width: 15, height: 15, borderRadius: "50%", background: "#fff",
                    left: on ? 17 : 2, transition: "left .15s",
                  }} />
                </span>
              </div>
            ))}
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

const FinalCta = () => (
  <section className="mkt-final" id="pricing">
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
    <div className="mkt-wrap">
      <div className="mkt-footer-row">
        <span className="mkt-footer-logo"><Mark size={22} />{"Schoolivio"}</span>
        <nav className="mkt-footer-links">
          <a href="#product">{"Product"}</a>
          <a href="#configure">{"Configure"}</a>
          <a href="mailto:hello@schoolivio.com">{"Contact"}</a>
        </nav>
      </div>
      <div className="mkt-footer-fine">{`© ${new Date().getFullYear()} Schoolivio. All rights reserved.`}</div>
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
    <FinalCta />
    <Footer />
  </div>
);

export default Landing;
