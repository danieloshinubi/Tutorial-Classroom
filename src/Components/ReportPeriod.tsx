import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Select } from "./UI";
import { db, fail } from "../lib/db";

// The period a report covers (supabase/264): one term, one whole session, or
// all time. Picked once and carried in the address (?period=term:…), so
// moving from the Reports list to a pupil keeps the same term, and a printed
// or shared report says which term it is. Defaults to the current term.

type Session = { id: string; name: string; starts_on: string | null; ends_on: string | null; is_current: boolean };
type Term = { id: string; name: string; session_id: string | null; position: number | null; starts_on: string | null; ends_on: string | null; is_current: boolean };

export type Period = {
  key: string; // "term:<id>" | "session:<id>" | "all"
  label: string; // "First Term · 2026/2027"
  from: string | null; // ISO, inclusive
  to: string | null; // ISO, exclusive
  termIds: string[] | null; // the terms it covers (null: all)
};

const ALL: Period = { key: "all", label: "All time", from: null, to: null, termIds: null };

// Midnight of a date in the SCHOOL's time zone, not the viewer's: a parent
// abroad and the school then see the same term, to the minute.
const zoneOffsetMs = (instant: number, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value || 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instant;
};
const startOf = (d: string, zone: string) => {
  const guess = Date.parse(`${d}T00:00:00Z`);
  try {
    return new Date(guess - zoneOffsetMs(guess, zone)).toISOString();
  } catch {
    return new Date(guess).toISOString();
  }
};
// The day after a date, as the exclusive end of a period.
const dayAfter = (d: string, zone: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return startOf(x.toISOString().slice(0, 10), zone);
};

const from = (t: string) => (db as unknown as { from: (t: string) => any }).from(t); // eslint-disable-line @typescript-eslint/no-explicit-any

export const useReportPeriod = (schoolId: string | null | undefined, timezone?: string | null) => {
  const [params, setParams] = useSearchParams();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);

  useEffect(() => {
    if (!schoolId) return undefined;
    let live = true;
    Promise.all([
      from("sessions").select("id, name, starts_on, ends_on, is_current").eq("school_id", schoolId),
      from("terms").select("id, name, session_id, position, starts_on, ends_on, is_current").eq("school_id", schoolId),
    ]).then(([s, t]: { data: unknown; error: { message: string } | null }[]) => {
      if (!live) return;
      if (s.error) fail(s.error, "Could not load the sessions.");
      if (t.error) fail(t.error, "Could not load the terms.");
      setSessions((s.data as Session[]) || []);
      setTerms((t.data as Term[]) || []);
    }).catch(() => live && setSessions([]));
    return () => {
      live = false;
    };
  }, [schoolId]);

  // Every choice, newest session first, its terms in order under it.
  const periods = useMemo(() => {
    const out: Period[] = [];
    const tz = timezone || "Africa/Lagos";
    const sorted = [...(sessions || [])].sort((a, b) => (b.starts_on || "").localeCompare(a.starts_on || "") || b.name.localeCompare(a.name));
    sorted.forEach((sess) => {
      const own = terms
        .filter((t) => t.session_id === sess.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.starts_on || "").localeCompare(b.starts_on || ""));
      own.forEach((t, i) => {
        // A term with no end runs to the next term's start, or the session's end.
        const next = own[i + 1];
        const to = t.ends_on ? dayAfter(t.ends_on, tz) : next?.starts_on ? startOf(next.starts_on, tz) : sess.ends_on ? dayAfter(sess.ends_on, tz) : null;
        out.push({ key: `term:${t.id}`, label: `${t.name} · ${sess.name}`, from: t.starts_on ? startOf(t.starts_on, tz) : null, to, termIds: [t.id] });
      });
      const first = sess.starts_on || own.map((t) => t.starts_on).filter(Boolean).sort()[0] || null;
      const last = sess.ends_on || own.map((t) => t.ends_on).filter(Boolean).sort().pop() || null;
      out.push({ key: `session:${sess.id}`, label: `Whole session · ${sess.name}`, from: first ? startOf(first, tz) : null, to: last ? dayAfter(last, tz) : null, termIds: own.map((t) => t.id) });
    });
    // Terms not filed under a session.
    terms
      .filter((t) => !t.session_id || !(sessions || []).some((s) => s.id === t.session_id))
      .forEach((t) => out.push({ key: `term:${t.id}`, label: t.name, from: t.starts_on ? startOf(t.starts_on, tz) : null, to: t.ends_on ? dayAfter(t.ends_on, tz) : null, termIds: [t.id] }));
    out.push(ALL);
    return out;
  }, [sessions, terms, timezone]);

  const fallback = useMemo(() => {
    const current = terms.find((t) => t.is_current);
    if (current) return `term:${current.id}`;
    const sess = (sessions || []).find((s) => s.is_current);
    return sess ? `session:${sess.id}` : "all";
  }, [terms, sessions]);

  const key = params.get("period") || fallback;
  const period = periods.find((p) => p.key === key) || periods.find((p) => p.key === fallback) || ALL;

  const setPeriod = (k: string) => {
    const next = new URLSearchParams(params);
    next.set("period", k);
    setParams(next, { replace: true });
  };

  return { ready: sessions !== null, periods, period, setPeriod };
};

export const PeriodPicker = ({ periods, period, onChange }: { periods: Period[]; period: Period; onChange: (k: string) => void }) => (
  <label className="report-period">
    <span>{"Report for"}</span>
    <Select value={period.key} onChange={onChange} options={periods.map((p) => ({ value: p.key, label: p.label }))} />
  </label>
);

// Carries the chosen period onto a link (Reports list → a pupil, and back).
export const withPeriod = (path: string, period: Period) => `${path}?period=${encodeURIComponent(period.key)}`;
