import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { checkSlugAvailable, startTrialSchool } from "../lib/marketingApi";
import { schoolUrl } from "../lib/tenant";
import { Mark } from "../Components/Logo";
import { LocaleConfirm, TimeZoneSelect } from "../Components/LocalePickers";
import { detectLocale } from "../lib/currencies";

// Start a free trial (schoolivio.com/Start-Trial): names the school, picks its
// address and currency, creates the owner's account if needed, then sends
// them to the new school's own sign-in. TypeScript + Tailwind (2026-10-15);
// the colours are the marketing site's own (marketing.css), not the app's.

type SlugStatus = null | "checking" | "ok" | "taken" | "invalid";
type Form = {
  schoolName: string;
  slug: string;
  firstName: string;
  surname: string;
  email: string;
  password: string;
  country: string | null;
  currency: string;
  timezone: string;
};

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 40);

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message) || fallback;

// The marketing site's look, as Tailwind classes.
const shell = "tw-flex tw-min-h-screen tw-items-center tw-justify-center tw-bg-[#f5f3ef] tw-px-5 tw-py-10 tw-text-[#111111] [font-family:Poppins,system-ui,-apple-system,sans-serif]";
const card = "tw-w-full tw-max-w-[440px] tw-rounded-[22px] tw-border tw-border-solid tw-border-[rgba(17,17,17,0.07)] tw-bg-white tw-p-10 tw-shadow-[0_20px_60px_rgba(0,0,0,0.08)] mobile:tw-p-7";
const heading = "tw-mb-1.5 tw-mt-[18px] tw-text-[24px] tw-font-semibold tw-tracking-[-0.04em] tw-text-[#111111]";
const lede = "tw-m-0 tw-mb-6 tw-text-[14px] tw-text-[rgba(17,17,17,0.45)]";
const label = "tw-mb-1.5 tw-block tw-text-[13px] tw-font-semibold tw-text-[#111111]";
const field = "tw-mb-4";
const inputCls =
  "tw-w-full tw-rounded-[10px] tw-border tw-border-solid tw-border-[rgba(17,17,17,0.14)] tw-bg-[#fcfbf8] tw-px-[13px] tw-py-[11px] tw-text-[14px] tw-text-[#111111] focus:tw-border-[#7c4fe0] focus:tw-shadow-[0_0_0_3px_rgba(124,79,224,0.12)] focus:tw-outline-none [font-family:inherit]";
const primaryBtn =
  "tw-inline-flex tw-h-12 tw-w-full tw-cursor-pointer tw-items-center tw-justify-center tw-gap-2 tw-whitespace-nowrap tw-rounded-full tw-border tw-border-solid tw-border-transparent tw-bg-[#7c4fe0] tw-px-6 tw-text-[12px] tw-font-semibold tw-text-white tw-shadow-[0_8px_25px_rgba(124,79,224,0.35)] tw-transition hover:tw-bg-[#8f63ee] active:tw-scale-[0.97] disabled:tw-cursor-not-allowed disabled:tw-opacity-55 [font-family:inherit]";
const hint = "tw-m-0 tw-mt-[5px] tw-text-[12px]";
const errorBox = "tw-mb-4 tw-rounded-[10px] tw-bg-[#fdeceb] tw-px-3.5 tw-py-2.5 tw-text-[13px] tw-text-[#b6301f]";

const StartTrial = () => {
  const { user, signUp, signIn } = useAuth();

  // The currency the school bills parents, sells and pays salaries in, and
  // its time zone (supabase/226). The device suggests them; the person
  // confirms the country and currency before the school is created
  // (LocaleConfirm). The country sets which pay rules payroll starts with.
  const [detected] = useState(detectLocale);
  const [form, setForm] = useState<Form>(() => ({
    schoolName: "",
    slug: "",
    firstName: "",
    surname: "",
    email: "",
    password: "",
    country: detected.country,
    currency: detected.currency,
    timezone: detected.timezone,
  }));
  const [currencyDecided, setCurrencyDecided] = useState(!detected.country);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const checkRef = useRef(0);

  const update = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "schoolName" && !slugTouched) next.slug = slugify(value);
      return next;
    });
  };

  // Whether the address is free, checked a moment after typing stops.
  useEffect(() => {
    const candidate = form.slug;
    if (!candidate) {
      setSlugStatus(null);
      return undefined;
    }
    if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(candidate)) {
      setSlugStatus("invalid");
      return undefined;
    }
    const myCheck = ++checkRef.current;
    setSlugStatus("checking");
    const t = setTimeout(async () => {
      try {
        const available = await checkSlugAvailable(candidate);
        if (checkRef.current === myCheck) setSlugStatus(available ? "ok" : "taken");
      } catch {
        if (checkRef.current === myCheck) setSlugStatus(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [form.slug]);

  // The session just created lives on this origin (schoolivio.com) — it
  // cannot follow across to the new school's own subdomain, browser storage
  // being scoped per-origin. Land them on that school's sign-in instead of a
  // /Dashboard they have no session for, with the email prefilled and a
  // one-time welcome note. Never carries the password.
  const goToNewSchool = () => {
    const to = new URL(schoolUrl(form.slug));
    to.pathname = "/Login";
    to.searchParams.set("email", form.email.trim());
    to.searchParams.set("welcome", "1");
    window.location.href = to.toString();
  };

  const createSchool = () =>
    startTrialSchool({ name: form.schoolName.trim(), slug: form.slug, currency: form.currency, timezone: form.timezone, country: form.country });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.schoolName.trim()) return setError("Give your school a name.");
    if (slugStatus !== "ok") return setError("Choose an available subdomain first.");
    if (!currencyDecided) return setError("Confirm your school's currency first.");

    if (!user) {
      if (!form.firstName.trim() || !form.surname.trim()) return setError("Your first and last name are both required.");
      if (!form.email.trim()) return setError("An email address is required.");
      if (form.password.length < 6) return setError("Password must be at least 6 characters.");
    }

    setSubmitting(true);
    try {
      // Already signed in (came back to finish, or started a second school)
      // — skip straight to creating the school under this account.
      if (user) {
        await createSchool();
        goToNewSchool();
        return;
      }

      const result = await signUp({
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        username: form.email.trim().split("@")[0],
        role: "student",
      });

      if (!result.session) {
        // Email confirmation is switched on for this project — nothing more
        // can happen until that's done. Once confirmed, signing in here and
        // submitting again finishes creating the school (the `user` branch
        // above handles that second pass).
        setAwaitingConfirm(true);
        return;
      }

      await createSchool();
      goToNewSchool();
    } catch (err) {
      setError(message(err, "Could not start your trial. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const signInInstead = async (e: React.MouseEvent) => {
    e.preventDefault();
    setError("");
    if (!form.email.trim() || !form.password) {
      setError("Enter your email and password above, then click this link again.");
      return;
    }
    try {
      await signIn({ email: form.email.trim(), password: form.password });
    } catch (err) {
      setError(message(err, "Could not sign in."));
    }
  };

  if (awaitingConfirm) {
    return (
      <div className={shell}>
        <div className={card}>
          <Mark size={34} />
          <h1 className={heading}>{"Check your email"}</h1>
          <p className={lede}>
            {`We sent a confirmation link to ${form.email}. Once you've confirmed it, sign in below and we'll finish creating ${form.schoolName || "your school"}.`}
          </p>
          <button
            type="button"
            className={primaryBtn}
            onClick={async () => {
              setError("");
              try {
                await signIn({ email: form.email.trim(), password: form.password });
                setAwaitingConfirm(false);
              } catch (err) {
                setError(message(err, "Not confirmed yet — check your email first."));
              }
            }}
          >
            {"I've confirmed — sign me in"}
          </button>
          {error ? <div className={`${errorBox} tw-mb-0 tw-mt-3.5`}>{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className={card}>
        <Link to="/" className="tw-mb-[18px] tw-inline-block tw-text-[13.5px] tw-text-[rgba(17,17,17,0.45)] tw-no-underline hover:tw-text-[#111111]">
          {"← Back to schoolivio.com"}
        </Link>
        <Mark size={34} />
        <h1 className={heading}>{user ? "Start another school" : "Start your 21-day free trial"}</h1>
        <p className={lede}>
          {user ? "You're signed in — just name the school and pick its address." : "No credit card needed. You'll be the school's owner from the moment it's created."}
        </p>

        {error ? <div className={errorBox}>{error}</div> : null}

        <form onSubmit={submit}>
          <div className={field}>
            <label className={label} htmlFor="st-school">{"School name"}</label>
            <input id="st-school" className={inputCls} value={form.schoolName} onChange={update("schoolName")} placeholder="Your school's name" />
          </div>

          <div className={field}>
            <label className={label} htmlFor="st-slug">{"Your school's address"}</label>
            <div className="tw-flex tw-items-center tw-overflow-hidden tw-rounded-[10px] tw-border tw-border-solid tw-border-[rgba(17,17,17,0.14)] tw-bg-[#fcfbf8] focus-within:tw-border-[#7c4fe0] focus-within:tw-shadow-[0_0_0_3px_rgba(124,79,224,0.12)]">
              <input
                id="st-slug"
                className="tw-min-w-0 tw-flex-1 tw-border-0 tw-bg-transparent tw-px-[13px] tw-py-[11px] tw-text-[14px] tw-text-[#111111] focus:tw-outline-none [font-family:inherit]"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm((f) => ({ ...f, slug: slugify(e.target.value) }));
                }}
                placeholder="your-school"
              />
              <span className="tw-whitespace-nowrap tw-px-3 tw-text-[13px] tw-text-[rgba(17,17,17,0.45)]">{".schoolivio.com"}</span>
            </div>
            {slugStatus === "checking" ? <p className={`${hint} tw-text-[rgba(17,17,17,0.35)]`}>{"Checking..."}</p> : null}
            {slugStatus === "ok" ? <p className={`${hint} tw-text-[#1a8a4c]`}>{"Available"}</p> : null}
            {slugStatus === "taken" ? <p className={`${hint} tw-text-[#c23636]`}>{"That address is already taken"}</p> : null}
            {slugStatus === "invalid" ? <p className={`${hint} tw-text-[#c23636]`}>{"Lowercase letters, numbers and hyphens only, 3+ characters"}</p> : null}
          </div>

          <div className={field}>
            <span className={label}>{"Country and currency"}</span>
            <LocaleConfirm
              detected={detected}
              value={{ country: form.country, currency: form.currency }}
              onChange={(next) => setForm((f) => ({ ...f, ...next }))}
              onDecided={() => setCurrencyDecided(true)}
            />
            <p className={`${hint} tw-text-[rgba(17,17,17,0.35)]`}>{"What your school bills parents, sells and pays salaries in."}</p>
          </div>

          <div className={field}>
            <span className={label}>{"Time zone"}</span>
            <TimeZoneSelect value={form.timezone} onChange={(timezone) => setForm((f) => ({ ...f, timezone }))} />
          </div>

          {!user ? (
            <>
              <div className="tw-grid tw-grid-cols-2 tw-gap-3">
                <div className={field}>
                  <label className={label} htmlFor="st-first">{"First name"}</label>
                  <input id="st-first" className={inputCls} value={form.firstName} onChange={update("firstName")} autoComplete="given-name" />
                </div>
                <div className={field}>
                  <label className={label} htmlFor="st-surname">{"Surname"}</label>
                  <input id="st-surname" className={inputCls} value={form.surname} onChange={update("surname")} autoComplete="family-name" />
                </div>
              </div>
              <div className={field}>
                <label className={label} htmlFor="st-email">{"Email"}</label>
                <input id="st-email" type="email" className={inputCls} value={form.email} onChange={update("email")} placeholder="you@example.com" autoComplete="email" />
              </div>
              <div className={field}>
                <label className={label} htmlFor="st-password">{"Password"}</label>
                <input id="st-password" type="password" className={inputCls} value={form.password} onChange={update("password")} placeholder="At least 6 characters" autoComplete="new-password" />
              </div>
            </>
          ) : null}

          <button type="submit" className={primaryBtn} disabled={submitting}>
            {submitting ? "Creating your school..." : "Create my school's workspace"}
          </button>
        </form>

        {!user ? (
          <p className="tw-m-0 tw-mt-[18px] tw-text-center tw-text-[13px] tw-text-[#8a839c]">
            {"Already have a Schoolivio account? "}
            <a href="#signin" onClick={signInInstead} className="tw-font-semibold tw-text-[#7c4fe0]">
              {"Sign in instead"}
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default StartTrial;
