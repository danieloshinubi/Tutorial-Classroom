import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { resolveSlug } from "../lib/tenant";
import Logo, { Mark } from "./Logo";

// What the platform ties together, drawn as an orbit around the school.
//
// A picture of the actual proposition: the classroom, the exam hall, the
// bursary and the parent all hanging off one place. Drawn rather than
// illustrated so it costs nothing to ship and recolours with the theme.
const Orbit = () => (
  <svg className="auth-orbit" viewBox="0 0 420 420" role="img" aria-label="">
    <defs>
      <radialGradient id="auth-glow" cx="50%" cy="50%">
        <stop offset="0" stopColor="#ffffff" stopOpacity=".9" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
    </defs>

    <circle cx="210" cy="210" r="200" fill="url(#auth-glow)" />
    {[70, 122, 174].map((r) => (
      <circle
        key={r}
        cx="210"
        cy="210"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity=".22"
      />
    ))}

    {/* Each satellite is one thing a school stops doing by hand.
        Placed on a ring at an angle rather than an x/y so it can travel
        round. The whole scene revolves; each satellite counter-rotates so
        the icon stays the right way up while its position moves. */}
    {[
      { radius: 174, degree:   0, label: "Classroom", icon: "📚" },
      { radius: 174, degree:  72, label: "Exams",     icon: "📝" },
      { radius: 122, degree: 144, label: "Fees",      icon: "💳" },
      { radius: 174, degree: 216, label: "Parents",   icon: "👨‍👩‍👦" },
      { radius: 122, degree: 288, label: "Results",   icon: "🎓" },
    ].map((node) => (
      <g
        key={node.label}
        className="auth-orbit-sat"
        style={{
          "--r": `${node.radius}px`,
          "--a": `${node.degree}deg`,
        }}
      >
        <g className="auth-orbit-upright">
          <circle r="26" fill="#ffffff" />
          <text y="7" textAnchor="middle" fontSize="20">
            {node.icon}
          </text>
        </g>
      </g>
    ))}

    {/* The centre is left blank: the Schoolivio mark is overlaid in HTML so
        it stays crisp and shares one definition with the rest of the app. */}
    <circle cx="210" cy="210" r="40" fill="#ffffff" />
  </svg>
);

// Three things worth saying, rotated. The dots make it obvious there is more
// than one rather than leaving somebody to wonder if the text changed.
const PITCHES = [
  {
    head: ["Everything a school runs on,", " in one place"],
    body: "Coursework, assignments and exams beside admissions, fees and results — so nobody is copying figures between two systems.",
  },
  {
    head: ["Results reach parents", " when you release them"],
    body: "Marks move from the teacher to the principal to the parent in that order, and the database refuses to skip a step.",
  },
  {
    head: ["Fees that add up", " the same on both sides"],
    body: "A balance is what was billed minus what the bursary approved — the school and the family are never holding different numbers.",
  },
];

const AuthLayout = ({ title, subtitle, children, footer }) => {
  const [school, setSchool] = useState(null);
  const [slide, setSlide] = useState(0);
  const slug = resolveSlug();

  useEffect(() => {
    let active = true;
    supabase
      .rpc("public_school", { target_slug: slug })
      .then(({ data }) => {
        if (active && data?.length) setSchool(data[0]);
      })
      // A school that cannot be read is not an error worth showing on a login
      // screen — the panel simply falls back to the product name.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [slug]);

  // Still if the reader asked for less motion.
  const still = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    []
  );

  useEffect(() => {
    if (still) return undefined;
    const timer = setInterval(
      () => setSlide((n) => (n + 1) % PITCHES.length),
      7000
    );
    return () => clearInterval(timer);
  }, [still]);

  const pitch = PITCHES[slide];

  return (
    <div className="auth">
      <div className="auth-card">
        <main className="auth-main">
          <div className="auth-corner">
            <Logo size={26} />
          </div>

          <div className="auth-form">
            {/* The school, named before anything is typed — this is
                multi-tenant, and you should know whose door you are at. */}
            <div className="auth-badge">
              {school?.logo_url ? (
                <img src={school.logo_url} alt="" />
              ) : (
                <Mark size={30} />
              )}
            </div>

            <h1>{title}</h1>
            {school ? <p className="auth-school-name">{school.name}</p> : null}
            {subtitle ? <p className="auth-sub">{subtitle}</p> : null}

            {children}

            {footer ? <div className="auth-foot">{footer}</div> : null}
          </div>

          <p className="auth-legal">
            {school ? `${school.slug}.schoolivio.com` : "schoolivio.com"}
          </p>
        </main>

        <aside className="auth-aside">
          <div className="auth-aside-inner">
            <h2 className="auth-pitch">
              {pitch.head[0]}
              <span>{pitch.head[1]}</span>
            </h2>

            <div className="auth-art">
              <Orbit />
              <span className="auth-art-core">
                <Mark size={34} />
              </span>
            </div>

            <p className="auth-pitch-body">{pitch.body}</p>

            <div className="auth-dots">
              {PITCHES.map((p, index) => (
                <button
                  key={p.head[0]}
                  type="button"
                  className={index === slide ? "on" : undefined}
                  aria-label={`Slide ${index + 1}`}
                  aria-current={index === slide}
                  onClick={() => setSlide(index)}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default AuthLayout;
