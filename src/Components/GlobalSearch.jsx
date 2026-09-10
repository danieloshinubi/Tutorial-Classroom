import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { search as searchIcon } from "react-icons-kit/feather/search";
import { useSchool } from "../context/SchoolContext";
import { fetchCourses, fetchReportableStudents } from "../lib/api";
import { displayName, initials } from "./UI";

// Search across the things a person can actually reach.
//
// Deliberately not a decorative box. It searches courses and the students
// this viewer is entitled to see — the same reportable_students() the reports
// page uses, so a teacher searches their own students and a parent their
// children rather than the whole school. Nothing is fetched until the box is
// opened, and then once.
const GlobalSearch = () => {
  const { schoolId, roles } = useSchool();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState([]);
  const [people, setPeople] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const canSeeCourses = roles.some((r) =>
    ["owner", "admin", "principal", "teacher", "student"].includes(r)
  );

  const load = useCallback(async () => {
    if (loaded || !schoolId) return;
    setLoaded(true);
    const [c, p] = await Promise.all([
      canSeeCourses ? fetchCourses(schoolId).catch(() => []) : Promise.resolve([]),
      fetchReportableStudents(schoolId).catch(() => []),
    ]);
    setCourses(c);
    setPeople(p);
  }, [loaded, schoolId, canSeeCourses]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Ctrl/Cmd-K from anywhere, the shortcut people already expect.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
        load();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [load]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return { courses: [], people: [] };
    const match = (value) => (value || "").toLowerCase().includes(needle);
    return {
      courses: courses
        .filter((c) => match(c.code) || match(c.title))
        .slice(0, 5),
      people: people
        .filter((p) => match(p.first_name) || match(p.surname) || match(p.email))
        .slice(0, 5),
    };
  }, [query, courses, people]);

  const nothing =
    query.trim().length >= 2 &&
    results.courses.length === 0 &&
    results.people.length === 0;

  const go = (to) => {
    setOpen(false);
    setQuery("");
    navigate(to);
  };

  return (
    <div className="gsearch" ref={wrapRef}>
      <Icon icon={searchIcon} size={16} className="gsearch-icon" />
      <input
        ref={inputRef}
        className="gsearch-input"
        value={query}
        placeholder="Search courses and students"
        aria-label="Search"
        onFocus={() => {
          setOpen(true);
          load();
        }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query ? null : <kbd className="gsearch-kbd">{"Ctrl K"}</kbd>}

      {open && query.trim().length >= 2 ? (
        <div className="gsearch-panel">
          {results.courses.length ? (
            <div className="gsearch-group">
              <div className="account-heading">{"Courses"}</div>
              {results.courses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="account-item"
                  onClick={() => go(`/Courses/${c.code}`)}
                >
                  <strong>{c.code}</strong>
                  <span style={{ color: "var(--ink-3)" }}>{c.title}</span>
                </button>
              ))}
            </div>
          ) : null}

          {results.people.length ? (
            <div className="gsearch-group">
              <div className="account-heading">{"Students"}</div>
              {results.people.map((p) => (
                <button
                  key={p.student_id}
                  type="button"
                  className="account-item"
                  onClick={() => go(`/Reports/${p.student_id}`)}
                >
                  <span className="nav-avatar brand-mark" style={{ width: 22, height: 22, fontSize: 10 }}>
                    {initials(p)}
                  </span>
                  <span>{displayName(p)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {nothing ? (
            <div className="gsearch-empty">
              {`Nothing matching "${query.trim()}".`}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default GlobalSearch;
