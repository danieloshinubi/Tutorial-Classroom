import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "react-icons-kit";
import { userPlus } from "react-icons-kit/feather/userPlus";
import { refreshCw } from "react-icons-kit/feather/refreshCw";
import { search as searchIcon } from "react-icons-kit/feather/search";
import { chevronRight } from "react-icons-kit/feather/chevronRight";
import { Button, Field, Modal, Select, displayName, SkeletonTable } from "../../../Components/UI";
import { ExportButton } from "../../../Components/ExportButton";
import { useActionFeedback } from "../../../Components/Toast";
import { useAuth } from "../../../context/AuthContext";
import { useSchool } from "../../../context/SchoolContext";
import { fetchSchoolMembers, fetchModuleAccess, addSchoolUser } from "../../../lib/api";
import PersonPanel, { type Issued } from "./PersonPanel";
import type { Grants, Member } from "./peopleTypes";
import { Avatar, Chip, Command, ROLES, ROLE_LABEL, RolePill, usePresence } from "./ui";

// School admin → People, laid out like Microsoft 365's Active users: a clean
// list (name, email, job title, role), and everything else about a person in
// the panel that slides in when their row is clicked (PersonPanel). Adding
// someone and the one-time password after it are here; every other action
// lives in the panel, where the admin can see exactly whom they are acting on.

const EXPORT_COLUMNS = [
  { key: "profiles.first_name", label: "First name" },
  { key: "profiles.surname", label: "Surname" },
  { key: "profiles.email", label: "Email" },
  { key: "profiles.username", label: "Username" },
  { key: (m: Member) => m.job_title || "", label: "Job title" },
  { key: (m: Member) => ROLE_LABEL[m.role] || m.role, label: "Role" },
  { key: (m: Member) => (m.is_active ? "Active" : "Suspended"), label: "Status" },
  { key: "created_at", label: "Added", type: "date" },
];

const blankInvite = { email: "", firstName: "", surname: "", role: "teacher" };

// On a computer only the list scrolls: the page itself is held still (no
// outer scrollbar) and the list fills the window from where it starts down
// to the bottom, so the title, toolbar and filters above it stay put. Leaving
// People gives the page its own scrolling back. On a phone the page scrolls
// as usual.
const scrollParent = (el: HTMLElement | null): HTMLElement => {
  for (let node = el?.parentElement || null; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement;
};

const useFillHeight = (ready: boolean) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const phone = () => window.matchMedia("(max-width: 900px)").matches;
    if (!el) return undefined;
    const page = scrollParent(el);
    const before = { overflow: page.style.overflowY, top: page.scrollTop };
    const fit = () => {
      if (phone()) {
        page.style.overflowY = before.overflow;
        setHeight(null);
        return;
      }
      page.scrollTop = 0;
      page.style.overflowY = "hidden";
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(240, window.innerHeight - top - 24));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      page.style.overflowY = before.overflow;
    };
  }, [ready]);
  return { ref, height };
};

const PeopleSection = () => {
  const { user } = useAuth();
  const { schoolId } = useSchool();
  const presence = usePresence();
  const { setError, setNotice } = useActionFeedback();

  const [members, setMembers] = useState<Member[]>([]);
  const [grants, setGrants] = useState<Grants>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [invite, setInvite] = useState(blankInvite);
  const [inviting, setInviting] = useState(false);
  const [issued, setIssued] = useState<(Issued & { emailed?: boolean; role?: string }) | null>(null);
  const fill = useFillHeight(!loading);

  const load = useCallback(async () => {
    if (!schoolId) return;
    try {
      const [rows, access] = await Promise.all([fetchSchoolMembers(schoolId), fetchModuleAccess(schoolId)]);
      setMembers(rows as unknown as Member[]);
      const byUser: Grants = {};
      (access as { user_id: string; module: string; level: string }[]).forEach((g) => {
        (byUser[g.user_id] = byUser[g.user_id] || {})[g.module] = g.level;
      });
      setGrants(byUser);
    } catch (err) {
      setError((err as Error).message || "Could not load the school's people.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  // One row per person (someone with two roles shows both on one row), A–Z.
  const people = useMemo(() => {
    const byUser = new Map<string, { member: Member; roles: string[] }>();
    members.forEach((m) => {
      const entry = byUser.get(m.user_id);
      if (entry) entry.roles.push(m.role);
      else byUser.set(m.user_id, { member: m, roles: [m.role] });
    });
    return Array.from(byUser.values()).sort((a, b) => displayName(a.member.profiles).localeCompare(displayName(b.member.profiles)));
  }, [members]);

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    people.forEach((p) => p.roles.forEach((r) => (tally[r] = (tally[r] || 0) + 1)));
    return tally;
  }, [people]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people.filter(({ member, roles }) => {
      if (roleFilter !== "all" && !roles.includes(roleFilter)) return false;
      if (!needle) return true;
      return [displayName(member.profiles), member.profiles.email, member.profiles.username, member.job_title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [people, query, roleFilter]);

  const open = openId ? members.find((m) => m.user_id === openId) || null : null;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite.email.trim()) return setError("An email address is needed: it is how they sign in.");
    setInviting(true);
    try {
      const result = await addSchoolUser({ schoolId, ...invite });
      const who = [invite.firstName, invite.surname].filter(Boolean).join(" ") || invite.email;
      if (result.password) {
        setIssued({ name: who, email: result.email, password: result.password, emailed: result.emailed, role: ROLE_LABEL[invite.role] });
      } else {
        setNotice(`${who} has been emailed a link to set their password.`);
      }
      setInvite(blankInvite);
      setAdding(false);
      await load();
    } catch (err) {
      setError((err as Error).message || "Could not add that person.");
    } finally {
      setInviting(false);
    }
  };

  const filterChips = [
    { value: "all", label: "Everyone", count: people.length },
    ...ROLES.map(([value, label]) => ({ value, label, count: counts[value] || 0 })).filter((r) => r.count > 0),
  ];

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {/* Command bar */}
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-2">
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1">
          <Command icon={<Icon icon={userPlus} size={15} />} onClick={() => setAdding(true)}>
            {"Add someone"}
          </Command>
          <Command
            icon={<Icon icon={refreshCw} size={14} />}
            onClick={() => {
              setLoading(true);
              load();
            }}
          >
            {"Refresh"}
          </Command>
          <ExportButton columns={EXPORT_COLUMNS} rows={shown.map((s) => s.member)} filename="people" />
        </div>
        <label className="tw-flex tw-h-9 tw-w-[300px] tw-items-center tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 mobile:tw-w-full">
          <span className="tw-text-ink-3">
            <Icon icon={searchIcon} size={14} />
          </span>
          <input
            className="tw-h-full tw-w-full tw-border-0 tw-bg-transparent tw-text-[14px] tw-text-ink tw-outline-none [font-family:inherit]"
            placeholder="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {/* Filter by role */}
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <span className="tw-text-[13px] tw-text-ink-3">{"Show:"}</span>
        {filterChips.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setRoleFilter(c.value)}
            className={`tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-solid tw-px-3 tw-py-1 tw-text-[13px] tw-cursor-pointer tw-transition-colors [font-family:inherit] ${
              roleFilter === c.value ? "tw-border-brand tw-bg-brand-soft tw-font-semibold tw-text-brand" : "tw-border-line tw-bg-surface tw-text-ink-2 hover:tw-border-brand"
            }`}
          >
            {c.label}
            <span className="tw-text-[12px] tw-opacity-70">{c.count}</span>
          </button>
        ))}
      </div>

      {/* The list */}
      {loading ? (
        <SkeletonTable rows={8} cols={4} />
      ) : (
        <div className="tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface">
          <div ref={fill.ref} className="tw-overflow-auto" style={fill.height ? { maxHeight: fill.height - 40 } : undefined}>
            <table className="tw-w-full tw-border-collapse tw-text-left">
              <thead>
                <tr className="tw-border-0 tw-border-b tw-border-solid tw-border-line">
                  {["Display name", "Email or username", "Job title", "Role", ""].map((h, i) => (
                    <th
                      key={i}
                      className={`tw-sticky tw-top-0 tw-z-[1] tw-whitespace-nowrap tw-bg-bg tw-px-4 tw-py-2.5 tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-[0.05em] tw-text-ink-3 ${i === 4 ? "tw-w-8" : ""} ${i === 1 ? "mobile:tw-hidden" : ""} ${i === 2 ? "mobile:tw-hidden" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(({ member: m, roles }) => {
                  const status = presence.status(m.user_id);
                  const isOpen = openId === m.user_id;
                  return (
                    <tr
                      key={m.user_id}
                      onClick={() => setOpenId(m.user_id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpenId(m.user_id)}
                      tabIndex={0}
                      aria-label={`Open ${displayName(m.profiles)}`}
                      className={`tw-cursor-pointer tw-border-0 tw-border-b tw-border-solid tw-border-line tw-transition-colors last:tw-border-b-0 hover:tw-bg-bg focus:tw-bg-bg focus:tw-outline-none ${isOpen ? "tw-bg-brand-soft" : ""} ${m.is_active ? "" : "tw-opacity-60"}`}
                    >
                      <td className="tw-px-4 tw-py-3">
                        <span className="tw-flex tw-items-center tw-gap-3">
                          <Avatar p={m.profiles} size={36} presence={status} />
                          <span className="tw-flex tw-min-w-0 tw-flex-col">
                            <span className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
                              <strong className="tw-text-[14px] tw-font-semibold tw-text-ink">{displayName(m.profiles)}</strong>
                              {m.user_id === user?.id ? <Chip tone="success">{"You"}</Chip> : null}
                              {!m.is_active ? <Chip tone="danger">{"Suspended"}</Chip> : null}
                              {m.granted_via ? <Chip tone="warn">{"Schoolivio support"}</Chip> : null}
                            </span>
                            {/* On a phone the email sits under the name. */}
                            <span className="tw-hidden tw-truncate tw-text-[12.5px] tw-text-ink-3 mobile:tw-block">{m.profiles.email || m.profiles.username}</span>
                          </span>
                        </span>
                      </td>
                      <td className="tw-max-w-[280px] tw-truncate tw-px-4 tw-py-3 tw-text-[13.5px] tw-text-ink-2 mobile:tw-hidden">
                        {m.profiles.email || (m.profiles.username ? `@${m.profiles.username}` : "—")}
                      </td>
                      <td className="tw-px-4 tw-py-3 tw-text-[13.5px] tw-text-ink-2 mobile:tw-hidden">{m.job_title || <span className="tw-text-ink-3">{"—"}</span>}</td>
                      <td className="tw-px-4 tw-py-3">
                        <span className="tw-flex tw-flex-wrap tw-gap-1">
                          {roles.map((r) => (
                            <RolePill key={r} role={r} />
                          ))}
                        </span>
                      </td>
                      <td className="tw-px-3 tw-py-3 tw-text-ink-3">
                        <Icon icon={chevronRight} size={16} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length === 0 ? (
            <p className="tw-m-0 tw-px-4 tw-py-10 tw-text-center tw-text-[14px] tw-text-ink-3">{query || roleFilter !== "all" ? "Nobody matches." : "Nobody here yet."}</p>
          ) : (
            <p className="tw-m-0 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-bg-bg tw-px-4 tw-py-2 tw-text-[12.5px] tw-text-ink-3">
              {`${shown.length} of ${people.length} ${people.length === 1 ? "person" : "people"}`}
            </p>
          )}
        </div>
      )}

      {open ? (
        <PersonPanel
          member={open}
          members={members}
          grants={grants}
          currentUserId={user?.id || null}
          schoolId={schoolId as string}
          onChanged={load}
          onClose={() => setOpenId(null)}
          onIssued={setIssued}
        />
      ) : null}

      {adding ? (
        <Modal
          title="Add someone"
          subtitle={invite.role === "parent" ? "Parents use their own email: they are sent a link to choose a password." : "You get a temporary password to pass on. They replace it the first time they sign in."}
          onClose={() => setAdding(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                {"Cancel"}
              </Button>
              <Button type="submit" form="add-person-form" disabled={inviting}>
                {inviting ? "Adding..." : invite.role === "parent" ? "Send invitation" : "Create account"}
              </Button>
            </>
          }
        >
          <form id="add-person-form" onSubmit={handleInvite}>
            <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
              <Field label="First name">
                <input className="input" autoFocus value={invite.firstName} onChange={(e) => setInvite((c) => ({ ...c, firstName: e.target.value }))} />
              </Field>
              <Field label="Surname">
                <input className="input" value={invite.surname} onChange={(e) => setInvite((c) => ({ ...c, surname: e.target.value }))} />
              </Field>
            </div>
            <Field label="Email">
              <input className="input" type="email" placeholder="name@example.com" value={invite.email} onChange={(e) => setInvite((c) => ({ ...c, email: e.target.value }))} />
            </Field>
            <Field label="Role">
              <Select value={invite.role} onChange={(v) => setInvite((c) => ({ ...c, role: v }))} options={ROLES.map(([value, label]) => ({ value, label }))} />
            </Field>
          </form>
        </Modal>
      ) : null}

      {issued ? (
        <Modal
          title={issued.kind === "reset" ? `${issued.name}'s password has been reset` : `${issued.name} can now sign in`}
          subtitle={
            issued.kind === "reset"
              ? "Their old password stopped working. Give them this one; they choose their own the next time they sign in."
              : issued.emailed === false
                ? "The invitation email could not be sent. Give them these details instead."
                : "Give them these details. They choose their own password the first time they sign in."
          }
          onClose={() => setIssued(null)}
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(`${issued.email}  ${issued.password}`).catch(() => {})}
              >
                {"Copy"}
              </Button>
              <Button type="button" onClick={() => setIssued(null)}>
                {"Done"}
              </Button>
            </>
          }
        >
          <div className="tw-grid tw-gap-3">
            <div className="tw-rounded-lg tw-bg-bg tw-px-4 tw-py-3">
              <div className="tw-text-[12px] tw-font-semibold tw-text-ink-3">{"Email"}</div>
              <div className="tw-font-mono tw-text-[15px] tw-text-ink">{issued.email}</div>
            </div>
            <div className="tw-rounded-lg tw-bg-bg tw-px-4 tw-py-3">
              <div className="tw-text-[12px] tw-font-semibold tw-text-ink-3">{"Temporary password"}</div>
              <div className="tw-font-mono tw-text-[17px] tw-tracking-[0.02em] tw-text-ink">{issued.password}</div>
            </div>
            <p className="tw-m-0 tw-text-[12.5px] tw-text-ink-3">{"Shown once. It is not stored anywhere you can read it again."}</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
};

export default PeopleSection;
