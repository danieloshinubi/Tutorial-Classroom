import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { resolveSlug } from "../lib/tenant";
import { Mark } from "./Logo";

// The frame every sign-in screen sits in.
//
// The point of the left panel is that this is multi-tenant software: someone
// arriving at jane-nath.schoolivio.com should see Jane-Nath College before
// they type anything, not a generic product login. The school's name comes
// from a function that exposes only name and logo, since the visitor has not
// signed in yet.
const AuthLayout = ({ title, subtitle, children, footer }) => {
  const [school, setSchool] = useState(null);
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

  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="auth-brand">
          {school?.logo_url ? (
            <img src={school.logo_url} alt="" className="auth-logo" />
          ) : (
            <Mark size={38} />
          )}
          <span className="auth-wordmark">{"Schoolivio"}</span>
        </div>

        <div className="auth-aside-body">
          <h2 className="auth-school">{school?.name || "Your classroom"}</h2>
          <p className="auth-tagline">
            {school
              ? "Coursework, assignments, exams and results — in one place."
              : "Sign in to your school's classroom."}
          </p>
        </div>

        <p className="auth-aside-foot">
          {school ? `${school.slug}.schoolivio.com` : "schoolivio.com"}
        </p>
      </aside>

      <main className="auth-main">
        <div className="auth-form">
          {/* On a narrow screen the aside collapses, so the school is named
              here instead of disappearing entirely. */}
          <div className="auth-compact-brand">
            {school?.logo_url ? (
              <img src={school.logo_url} alt="" className="auth-logo" />
            ) : (
              <span className="auth-logo auth-logo-fallback">
                {(school?.name || "S").charAt(0).toUpperCase()}
              </span>
            )}
            <span>{school?.name || "Schoolivio"}</span>
          </div>

          <h1>{title}</h1>
          {subtitle ? <p className="auth-sub">{subtitle}</p> : null}

          {children}

          {footer ? <div className="auth-foot">{footer}</div> : null}
        </div>

        <p className="auth-legal">
          {"Trouble signing in? Ask your school administrator, or use "}
          <Link to="/Forgot-Password">{"forgot password"}</Link>
          {"."}
        </p>
      </main>
    </div>
  );
};

export default AuthLayout;
