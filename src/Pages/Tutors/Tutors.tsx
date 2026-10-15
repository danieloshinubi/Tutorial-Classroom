import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { Page, SkeletonList, displayName } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import { fetchTutors, openDirectMessage } from "../../lib/api";

// Tutors (2026-10-15): the school's teachers and principals, and anyone else
// who teaches one of its courses (supabase/263), with what each teaches and
// a way to message them. Someone with no photo gets their initials, never a
// stand-in picture of somebody else.

type Tutor = {
  id: string;
  first_name: string | null;
  surname: string | null;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  bio: string | null;
  school_role: string;
  courses: string[];
};

const ROLE_LABEL: Record<string, string> = { teacher: "Teacher", principal: "Principal", owner: "Proprietor", admin: "Admin" };
const FILTERS = [
  { id: "all", label: "All" },
  { id: "teacher", label: "Teachers" },
  { id: "principal", label: "Principals" },
  { id: "owner", label: "Proprietors" },
];

// Initials on a colour picked from the name, so each person is told apart
// at a glance and keeps the same colour everywhere.
const TINTS = [
  ["#e0f2f1", "#00796b"],
  ["#e8eaf6", "#3949ab"],
  ["#fce4ec", "#ad1457"],
  ["#fff3e0", "#e65100"],
  ["#ede7f6", "#5e35b1"],
  ["#e3f2fd", "#1565c0"],
  ["#f1f8e9", "#558b2f"],
];
const initials = (t: Tutor) => {
  const name = displayName(t).trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] || "")).toUpperCase() || "?";
};
const tint = (id: string) => TINTS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];

const Avatar = ({ t }: { t: Tutor }) => {
  const [broken, setBroken] = useState(false);
  if (t.avatar_url && !broken) {
    return <img src={t.avatar_url} alt="" onError={() => setBroken(true)} className="tw-h-14 tw-w-14 tw-shrink-0 tw-rounded-full tw-object-cover" />;
  }
  const [bg, fg] = tint(t.id);
  return (
    <span aria-hidden="true" className="tw-inline-flex tw-h-14 tw-w-14 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-text-[19px] tw-font-bold" style={{ background: bg, color: fg }}>
      {initials(t)}
    </span>
  );
};

const SHOWN = 4;

export const TutorCard = ({ t, me, onMessage, busy }: { t: Tutor; me: boolean; onMessage: () => void; busy: boolean }) => {
  const [all, setAll] = useState(false);
  const courses = all ? t.courses : t.courses.slice(0, SHOWN);
  const more = t.courses.length - SHOWN;
  return (
    <li className="tw-flex tw-flex-col tw-gap-4 tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 tw-shadow-1">
      <div className="tw-flex tw-items-center tw-gap-3.5">
        <Avatar t={t} />
        <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-1">
          <span className="tw-line-clamp-2 tw-break-words tw-text-[16px] tw-font-bold tw-leading-snug tw-text-ink" title={displayName(t)}>
            {displayName(t)}
            {me ? <span className="tw-ml-1.5 tw-text-[12.5px] tw-font-medium tw-text-ink-3">{"(you)"}</span> : null}
          </span>
          <span className="tw-w-fit tw-rounded-full tw-bg-brand-soft tw-px-2.5 tw-py-0.5 tw-text-[12px] tw-font-semibold tw-text-brand">{ROLE_LABEL[t.school_role] || "Teacher"}</span>
        </div>
      </div>

      {t.bio ? <p className="tw-m-0 tw-line-clamp-3 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">{t.bio}</p> : null}

      <div className="tw-flex tw-flex-col tw-gap-2">
        <span className="tw-text-[11.5px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">
          {t.courses.length ? `Teaches ${t.courses.length} subject${t.courses.length === 1 ? "" : "s"}` : "Subjects"}
        </span>
        {t.courses.length ? (
          <div className="tw-flex tw-flex-wrap tw-gap-1.5">
            {courses.map((c) => (
              <span key={c} className="tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-bg tw-px-2.5 tw-py-1 tw-text-[12.5px] tw-text-ink-2">
                {c}
              </span>
            ))}
            {more > 0 ? (
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="tw-cursor-pointer tw-rounded-full tw-border-0 tw-bg-transparent tw-px-2 tw-py-1 tw-text-[12.5px] tw-font-semibold tw-text-brand hover:tw-underline [font-family:inherit]"
              >
                {all ? "Show fewer" : `+${more} more`}
              </button>
            ) : null}
          </div>
        ) : (
          <span className="tw-text-[13px] tw-text-ink-3">{"No subjects assigned yet."}</span>
        )}
      </div>

      {me ? null : (
        <button
          type="button"
          onClick={onMessage}
          disabled={busy}
          className="tw-mt-auto tw-inline-flex tw-cursor-pointer tw-items-center tw-justify-center tw-gap-2 tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-4 tw-py-2 tw-text-[13.5px] tw-font-semibold tw-text-ink hover:tw-border-brand hover:tw-text-brand disabled:tw-opacity-60 [font-family:inherit]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {busy ? "Opening…" : "Message"}
        </button>
      )}
    </li>
  );
};

const Tutors = () => {
  const navigate = useNavigate();
  const { schoolId, school } = useSchool();
  const { user } = useAuth() as { user: { id: string } | null };
  const { setError } = useActionFeedback();
  const [tutors, setTutors] = useState<Tutor[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) return undefined;
    let live = true;
    fetchTutors(schoolId)
      .then((d: Tutor[]) => live && setTutors(d))
      .catch((e: Error) => {
        if (live) {
          setTutors([]);
          setError(e.message || "Could not load the tutors.");
        }
      });
    return () => {
      live = false;
    };
  }, [schoolId, setError]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tutors?.length || 0 };
    (tutors || []).forEach((t) => (c[t.school_role] = (c[t.school_role] || 0) + 1));
    return c;
  }, [tutors]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tutors || []).filter(
      (t) =>
        (filter === "all" || t.school_role === filter) &&
        (!needle || displayName(t).toLowerCase().includes(needle) || t.courses.some((c) => c.toLowerCase().includes(needle))),
    );
  }, [tutors, q, filter]);

  const message = async (t: Tutor) => {
    if (!schoolId) return;
    setOpening(t.id);
    try {
      const id = await openDirectMessage({ schoolId, otherUserId: t.id });
      navigate(`/Chat/${id}`);
    } catch (e) {
      setError((e as Error).message || "Could not open the chat.");
      setOpening(null);
    }
  };

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Tutors"
        subtitle={tutors ? `${tutors.length} ${tutors.length === 1 ? "person teaches" : "people teach"} at ${school?.name || "your school"}` : undefined}
      >
        <div className="tw-flex tw-flex-col tw-gap-5 [font-family:inherit]">
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
            <label className="tw-flex tw-w-[320px] tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-4 tw-py-2 mobile:tw-w-full">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tw-shrink-0 tw-text-ink-3" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or subject"
                className="tw-w-full tw-border-0 tw-bg-transparent tw-text-[14px] tw-text-ink tw-outline-none [font-family:inherit]"
              />
            </label>
            <div className="tw-flex tw-flex-wrap tw-gap-1 tw-rounded-full tw-bg-bg tw-p-1">
              {FILTERS.filter((f) => f.id === "all" || counts[f.id]).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`tw-cursor-pointer tw-whitespace-nowrap tw-rounded-full tw-border-0 tw-px-4 tw-py-1.5 tw-text-[13.5px] [font-family:inherit] ${
                    filter === f.id ? "tw-bg-surface tw-font-semibold tw-text-brand tw-shadow-1" : "tw-bg-transparent tw-text-ink-2 hover:tw-text-ink"
                  }`}
                >
                  {f.label}
                  <span className="tw-ml-1.5 tw-text-[12px] tw-text-ink-3">{counts[f.id] || 0}</span>
                </button>
              ))}
            </div>
          </div>

          {tutors === null ? (
            <SkeletonList rows={4} />
          ) : !shown.length ? (
            <div className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-10 tw-text-center tw-text-[14px] tw-text-ink-3">
              {tutors.length ? "Nobody matches that search." : "No teachers yet. Add them under School admin → People."}
            </div>
          ) : (
            <ul className="tw-m-0 tw-grid tw-list-none tw-grid-cols-[repeat(auto-fill,minmax(290px,1fr))] tw-items-start tw-gap-4 tw-p-0">
              {shown.map((t) => (
                <TutorCard key={t.id} t={t} me={t.id === user?.id} busy={opening === t.id} onMessage={() => message(t)} />
              ))}
            </ul>
          )}
        </div>
      </Page>
    </div>
  );
};

export default Tutors;
