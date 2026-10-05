import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "react-icons-kit";
import { x as closeIcon } from "react-icons-kit/feather/x";
import { lock } from "react-icons-kit/feather/lock";
import { userX } from "react-icons-kit/feather/userX";
import { userCheck } from "react-icons-kit/feather/userCheck";
import { trash2 } from "react-icons-kit/feather/trash2";
import { edit2 } from "react-icons-kit/feather/edit2";
import { mail } from "react-icons-kit/feather/mail";
import { briefcase } from "react-icons-kit/feather/briefcase";
import { shield } from "react-icons-kit/feather/shield";
import { users as usersIcon } from "react-icons-kit/feather/users";
import { fileText } from "react-icons-kit/feather/fileText";
import { Button, Field, Select, displayName, formatDate } from "../../../Components/UI";
import { ImageUpload } from "../../../Components/ImageUpload";
import { useActionFeedback } from "../../../Components/Toast";
import { confirmDialog } from "../../../Components/Confirm";
import { relativeMoment } from "../../../lib/presence";
import { STAFF_ROLES } from "../../../lib/orgChart";
import { SETTABLE_MODULES, ACCESS_LABEL, roleCovers, moduleById } from "../../../lib/modules";
import {
  updateMemberRole,
  updateMemberManager,
  setMemberActive,
  removeMember,
  updateProfile,
  updateMemberJobTitle,
  saveModuleAccess,
  resetMemberPassword,
  changeMemberEmail,
  uploadAvatar,
  removeAvatar,
  fetchChildren,
  fetchGuardiansOf,
  linkGuardian,
  unlinkGuardian,
} from "../../../lib/api";
import { ACCESS_WORD, fetchRegistrationOf, type Grants, type Member, type PersonProfile, type Registration } from "./peopleTypes";
import { Avatar, Chip, EmailLine, ROLES, ROLE_LABEL, RolePill, usePresence } from "./ui";

// One person, in a panel that slides in from the right when their row in
// School admin → People is clicked, the way Microsoft 365's admin centre
// shows a user. Everything about them in one place, and every action an
// admin takes on them: details, role and who they report to, what they can
// open, family links (a parent's children, a pupil's parents), a pupil's
// record, and resetting the password, suspending or removing them. Each
// action that cannot be undone asks first.

export interface Issued {
  kind?: "reset";
  name: string;
  email: string;
  password: string;
}

type Tab = "account" | "role" | "access" | "family" | "pupil";

interface Link {
  id: string;
  relationship: string | null;
  student?: PersonProfile;
  guardian?: PersonProfile;
}

// A labelled value inside a card.
const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-0.5">
    <span className="tw-text-[11.5px] tw-font-semibold tw-uppercase tw-tracking-[0.05em] tw-text-ink-3">{label}</span>
    <div className="tw-min-w-0 tw-text-[14px] tw-leading-snug tw-text-ink tw-break-words">{children}</div>
  </div>
);

// One group of facts: an icon, a title, an optional action, the content.
const Card = ({
  icon,
  title,
  action,
  wide,
  children,
}: {
  icon: unknown;
  title: string;
  action?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) => (
  <section className={`tw-min-w-0 tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 tw-shadow-1 ${wide ? "tw-col-span-2 mobile:tw-col-span-1" : ""}`}>
    <header className="tw-mb-4 tw-flex tw-items-center tw-gap-3">
      <span className="tw-inline-flex tw-h-8 tw-w-8 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-soft tw-text-brand">
        <Icon icon={icon as never} size={15} />
      </span>
      <h3 className="tw-m-0 tw-flex-1 tw-text-[15px] tw-font-semibold tw-text-ink">{title}</h3>
      {action}
    </header>
    <div className="tw-flex tw-flex-col tw-gap-3.5">{children}</div>
  </section>
);

const LinkButton = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="tw-rounded-full tw-border-0 tw-bg-transparent tw-px-2.5 tw-py-1 tw-text-[13px] tw-font-semibold tw-text-brand tw-cursor-pointer tw-transition-colors hover:tw-bg-brand-soft [font-family:inherit]"
  >
    {children}
  </button>
);

// The header's actions, as rounded pills.
const PillAction = ({
  icon,
  children,
  onClick,
  disabled,
  danger,
}: {
  icon: unknown;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-solid tw-px-3.5 tw-py-1.5 tw-text-[13px] tw-font-medium tw-cursor-pointer tw-transition-colors disabled:tw-cursor-not-allowed disabled:tw-opacity-40 [font-family:inherit] ${
      danger
        ? "tw-border-danger-soft tw-bg-surface tw-text-danger hover:tw-bg-danger-soft"
        : "tw-border-line tw-bg-surface tw-text-ink hover:tw-border-brand hover:tw-text-brand"
    }`}
  >
    <Icon icon={icon as never} size={14} />
    {children}
  </button>
);

const PersonRow = ({ p, sub, action }: { p: PersonProfile; sub?: string; action?: React.ReactNode }) => (
  <li className="tw-flex tw-items-center tw-gap-3 tw-py-2.5 tw-border-0 tw-border-b tw-border-solid tw-border-line last:tw-border-b-0">
    <Avatar p={p} size={34} />
    <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
      <strong className="tw-truncate tw-text-[14px] tw-text-ink">{displayName(p)}</strong>
      {sub ? <small className="tw-truncate tw-text-[12.5px] tw-text-ink-3">{sub}</small> : null}
    </span>
    {action}
  </li>
);

const PersonPanel = ({
  member,
  members,
  grants,
  currentUserId,
  schoolId,
  onChanged,
  onClose,
  onIssued,
}: {
  member: Member;
  members: Member[];
  grants: Grants;
  currentUserId: string | null;
  schoolId: string;
  onChanged: () => Promise<void> | void;
  onClose: () => void;
  onIssued: (issued: Issued) => void;
}) => {
  const { setError, setNotice } = useActionFeedback();
  const presence = usePresence();
  const p = member.profiles;
  const name = displayName(p);
  const isSelf = member.user_id === currentUserId;
  const isSupport = Boolean(member.granted_via);
  const roles = useMemo(() => members.filter((m) => m.user_id === member.user_id).map((m) => m.role), [members, member.user_id]);
  const isStaff = roles.some((r) => STAFF_ROLES.includes(r));
  const isParent = roles.includes("parent");
  const isStudent = roles.includes("student");
  const [tab, setTab] = useState<Tab>("account");
  const [busy, setBusy] = useState("");
  const [shown, setShown] = useState(false);

  // Slides in; Esc closes it.
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal")) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const act = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError("");
    try {
      await work();
      if (done) setNotice(done);
      await onChanged();
      return true;
    } catch (err) {
      setError((err as Error).message || "That did not work.");
      return false;
    } finally {
      setBusy("");
    }
  };

  /* --------------------------------------------------------- header actions */
  const resetPassword = async () => {
    if (!(await confirmDialog(`Reset ${name}'s password? Their current password stops working immediately, and they choose a new one the next time they sign in.`))) return;
    setBusy("reset");
    try {
      const result = await resetMemberPassword({ schoolId, userId: p.id });
      onIssued({ kind: "reset", name, email: result.email || p.email || "", password: result.password });
    } catch (err) {
      setError((err as Error).message || "Could not reset that password.");
    } finally {
      setBusy("");
    }
  };
  const toggleActive = async () => {
    if (member.is_active && !(await confirmDialog(`Suspend ${name}? They cannot sign in to this school until you restore them. Nothing of theirs is deleted.`))) return;
    await act("active", () => setMemberActive({ schoolId, memberId: member.id, isActive: !member.is_active }), member.is_active ? `${name} is suspended.` : `${name} is restored.`);
  };
  const remove = async () => {
    if (!(await confirmDialog(`Remove ${name} from this school? Their login stays, but they lose all access here.`))) return;
    if (await act("remove", () => removeMember({ memberId: member.id, schoolId }), `${name} was removed from the school.`)) onClose();
  };

  /* ---------------------------------------------------------------- account */
  const [editing, setEditing] = useState(false);
  const blank = useCallback(
    () => ({
      first_name: p.first_name || "",
      surname: p.surname || "",
      username: p.username || "",
      bio: p.bio || "",
      avatar_url: p.avatar_url || "",
      email: p.email || "",
      job_title: member.job_title || "",
    }),
    [p, member.job_title]
  );
  const [form, setForm] = useState(blank);
  useEffect(() => {
    setForm(blank());
  }, [blank]);
  useEffect(() => {
    setEditing(false);
    setTab("account");
  }, [member.user_id]);
  const set = (key: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const saveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await act(
      "account",
      async () => {
        const { job_title: jobTitle, email, ...profileFields } = form;
        // The sign-in address first: the step most likely to be refused.
        const newEmail = email.trim().toLowerCase();
        if (newEmail && newEmail !== (p.email || "").toLowerCase()) await changeMemberEmail({ schoolId, userId: member.user_id, email: newEmail });
        // Only what changed, and a blank username as none at all (usernames are unique).
        const before = p as unknown as Record<string, unknown>;
        const changes = Object.fromEntries(
          Object.entries({ ...profileFields, username: profileFields.username.trim() || null }).filter(([key, value]) => (value || null) !== (before[key] || null))
        );
        if (Object.keys(changes).length) await updateProfile(p.id, changes);
        if (jobTitle.trim() !== (member.job_title || "")) await updateMemberJobTitle({ schoolId, userId: member.user_id, jobTitle });
      },
      `${[form.first_name, form.surname].filter(Boolean).join(" ") || name}'s details are saved.`
    );
    if (ok) setEditing(false);
  };

  /* -------------------------------------------------------- role & reporting */
  const manager = member.manager_id ? members.find((m) => m.user_id === member.manager_id) : null;
  const reportsToThem = Array.from(new Map(members.filter((m) => m.manager_id === member.user_id && m.is_active).map((m) => [m.user_id, m])).values());
  const managerOptions = [
    { value: "", label: "Nobody (top of the organisation)" },
    ...Array.from(
      new Map(
        members
          .filter((m) => m.user_id !== member.user_id && m.is_active && STAFF_ROLES.includes(m.role))
          .map((m) => [m.user_id, { value: m.user_id, label: `${displayName(m.profiles)}${m.job_title ? ` · ${m.job_title}` : ""}` }])
      ).values()
    ).sort((a, b) => a.label.localeCompare(b.label)),
  ];

  /* ------------------------------------------------------------------ access */
  const mine = useMemo(() => grants[member.user_id] || {}, [grants, member.user_id]);
  const settable = SETTABLE_MODULES() as string[];
  const [access, setAccess] = useState<Record<string, string>>({});
  useEffect(() => {
    setAccess(Object.fromEntries(settable.map((id) => [id, mine[id] || ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);
  const normalised = (id: string, level: string) =>
    roleCovers(id, roles) ? (level === "none" || level === "read" ? level : "") : level === "read" || level === "edit" ? level : "";
  const accessChanged = settable.some((id) => normalised(id, access[id] || "") !== (mine[id] || ""));
  const saveAccess = () =>
    act(
      "access",
      async () => {
        const changed = Object.fromEntries(
          settable.map((id) => [id, normalised(id, access[id] || "")]).filter(([id, level]) => (mine[id] || "") !== level)
        );
        if (Object.keys(changed).length) await saveModuleAccess({ schoolId, userId: member.user_id, access: changed });
      },
      `${name}'s access is saved.`
    );

  /* ------------------------------------------------------------------ family */
  const [links, setLinks] = useState<Link[] | null>(null);
  const [linkWho, setLinkWho] = useState("");
  const [linkRel, setLinkRel] = useState("");
  const loadLinks = useCallback(async () => {
    if (!isParent && !isStudent) {
      setLinks([]);
      return;
    }
    try {
      const rows = isParent ? await fetchChildren(member.user_id, schoolId) : await fetchGuardiansOf(member.user_id, schoolId);
      setLinks(rows as unknown as Link[]);
    } catch {
      setLinks([]);
    }
  }, [isParent, isStudent, member.user_id, schoolId]);
  useEffect(() => {
    setLinks(null);
    loadLinks();
  }, [loadLinks]);
  const linkedIds = new Set((links || []).map((l) => (isParent ? l.student?.id : l.guardian?.id)));
  const linkCandidates = Array.from(
    new Map(
      members
        .filter((m) => m.role === (isParent ? "student" : "parent") && m.user_id !== member.user_id && !linkedIds.has(m.user_id))
        .map((m) => [m.user_id, { value: m.user_id, label: `${displayName(m.profiles)}${m.profiles.email ? ` · ${m.profiles.email}` : ""}` }])
    ).values()
  ).sort((a, b) => a.label.localeCompare(b.label));
  const addLink = () =>
    act(
      "link",
      async () => {
        await linkGuardian({
          schoolId,
          guardianId: isParent ? member.user_id : linkWho,
          studentId: isParent ? linkWho : member.user_id,
          relationship: linkRel.trim(),
        });
        setLinkWho("");
        setLinkRel("");
        await loadLinks();
      },
      "Linked. The parent now sees this child's bills, reports and news."
    );
  const removeLink = async (l: Link) => {
    const other = displayName((isParent ? l.student : l.guardian) as PersonProfile);
    if (!(await confirmDialog(isParent ? `Stop ${name} seeing ${other}'s records?` : `Stop ${other} seeing ${name}'s records?`))) return;
    await act(
      "unlink",
      async () => {
        await unlinkGuardian(l.id, schoolId);
        await loadLinks();
      },
      "Link removed."
    );
  };

  /* ------------------------------------------------------------------- pupil */
  const [registration, setRegistration] = useState<Registration | null | undefined>(undefined);
  useEffect(() => {
    setRegistration(undefined);
    if (isStudent) fetchRegistrationOf(schoolId, member.user_id).then(setRegistration).catch(() => setRegistration(null));
  }, [isStudent, schoolId, member.user_id]);

  /* ----------------------------------------------------------------- render */
  const status = presence.status(member.user_id);
  const lastIn = presence.lastSignIn(member.user_id);
  const tabs: { id: Tab; label: string }[] = [
    { id: "account", label: "Account" },
    { id: "role", label: "Role & reporting" },
    ...(isStaff && !isSupport ? [{ id: "access" as Tab, label: "Access" }] : []),
    ...(isParent || isStudent ? [{ id: "family" as Tab, label: isParent ? "Children" : "Parents" }] : []),
    ...(isStudent ? [{ id: "pupil" as Tab, label: "Pupil record" }] : []),
  ];
  const accessSummary = Object.entries(mine);
  const familyNames =
    links === null ? "Loading..." : links.length ? links.map((l) => displayName((isParent ? l.student : l.guardian) as PersonProfile)).join(", ") : "None linked yet";

  return createPortal(
    <div className="tw-fixed tw-inset-0 tw-z-[150] [font-family:inherit]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`tw-absolute tw-inset-0 tw-border-0 tw-bg-[rgb(15_23_42_/_0.4)] tw-backdrop-blur-[2px] tw-cursor-default tw-transition-opacity tw-duration-200 ${shown ? "tw-opacity-100" : "tw-opacity-0"}`}
      />
      <aside
        role="dialog"
        aria-label={name}
        className={`tw-absolute tw-right-0 tw-top-0 tw-flex tw-h-full tw-w-[min(740px,100vw)] tw-flex-col tw-bg-bg tw-shadow-3 tw-transition-transform tw-duration-300 tw-ease-out ${shown ? "tw-translate-x-0" : "tw-translate-x-full"}`}
      >
        {/* Header: a band of the school's colour, the person over it, and
            the actions an admin takes on them. */}
        <div className="tw-relative tw-shrink-0 tw-bg-surface tw-shadow-1">
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="tw-absolute tw-right-4 tw-top-4 tw-inline-flex tw-h-9 tw-w-9 tw-items-center tw-justify-center tw-rounded-full tw-border-0 tw-bg-transparent tw-text-ink-2 tw-cursor-pointer tw-transition-colors hover:tw-bg-bg hover:tw-text-ink"
          >
            <Icon icon={closeIcon} size={18} />
          </button>
          <div className="tw-px-7 tw-pb-1 tw-pt-7 mobile:tw-px-5">
            <div className="tw-flex tw-items-end tw-gap-4 tw-pr-10">
              <Avatar p={p} size={80} presence={status} />
              <div className="tw-mb-1 tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
                {roles.map((r) => (
                  <RolePill key={r} role={r} />
                ))}
                {isSelf ? <Chip tone="success">{"You"}</Chip> : null}
                {!member.is_active ? <Chip tone="danger">{"Suspended"}</Chip> : null}
                {isSupport ? <Chip tone="warn">{`Schoolivio support · until ${formatDate(member.access_expires_at)}`}</Chip> : null}
                {status !== "offline" ? <Chip tone="success">{status === "away" ? "Away" : "Online now"}</Chip> : null}
              </div>
            </div>
            <h2 className="tw-m-0 tw-mt-3 tw-text-[23px] tw-font-bold tw-leading-tight tw-tracking-[-0.01em] tw-text-ink">{name}</h2>
            <div className="tw-mt-1 tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-text-ink-2">
              <span className="tw-shrink-0 tw-text-[14px]">{member.job_title || "No job title"}</span>
              {p.email ? (
                <>
                  <span className="tw-text-ink-3">{"·"}</span>
                  <EmailLine email={p.email} />
                </>
              ) : null}
            </div>

            <div className="tw-mt-4 tw-flex tw-flex-wrap tw-gap-2">
              <PillAction icon={edit2} disabled={isSupport} onClick={() => { setTab("account"); setEditing(true); }}>
                {"Edit details"}
              </PillAction>
              <PillAction icon={lock} disabled={isSelf || isSupport || Boolean(busy)} onClick={resetPassword}>
                {"Reset password"}
              </PillAction>
              <PillAction icon={member.is_active ? userX : userCheck} disabled={isSelf || isSupport || Boolean(busy)} onClick={toggleActive}>
                {member.is_active ? "Suspend" : "Restore"}
              </PillAction>
              <PillAction icon={trash2} danger disabled={isSelf || Boolean(busy)} onClick={remove}>
                {isSupport ? "End access" : "Remove from school"}
              </PillAction>
            </div>

            <div role="tablist" className="tw-mt-5 tw-mb-4 tw-inline-flex tw-max-w-full tw-gap-1 tw-overflow-x-auto tw-rounded-full tw-bg-bg tw-p-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`tw-whitespace-nowrap tw-rounded-full tw-border-0 tw-px-4 tw-py-1.5 tw-text-[13.5px] tw-cursor-pointer tw-transition-all [font-family:inherit] ${
                    tab === t.id ? "tw-bg-surface tw-font-semibold tw-text-brand tw-shadow-1" : "tw-bg-transparent tw-font-medium tw-text-ink-2 hover:tw-text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="tw-flex-1 tw-overflow-y-auto tw-px-7 tw-py-6 mobile:tw-px-4">
          {tab === "account" ? (
            editing ? (
              <Card icon={edit2} title="Edit details">
                <form onSubmit={saveAccount} className="tw-flex tw-flex-col tw-gap-1">
                  <Field label="Photo">
                    <ImageUpload
                      value={form.avatar_url}
                      onUpload={async (file: File) => {
                        const url = await uploadAvatar({ userId: p.id, file });
                        setForm((f) => ({ ...f, avatar_url: url }));
                      }}
                      onRemove={async () => {
                        await removeAvatar(form.avatar_url);
                        setForm((f) => ({ ...f, avatar_url: "" }));
                      }}
                    />
                  </Field>
                  <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
                    <Field label="First name">
                      <input className="input" value={form.first_name} onChange={set("first_name")} />
                    </Field>
                    <Field label="Surname">
                      <input className="input" value={form.surname} onChange={set("surname")} />
                    </Field>
                  </div>
                  <Field label="Email" hint="The address they sign in with. Changing it takes effect at once.">
                    <input className="input" type="email" value={form.email} onChange={set("email")} />
                  </Field>
                  <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
                    <Field label="Username" hint="They can sign in with this too.">
                      <input className="input" value={form.username} onChange={set("username")} />
                    </Field>
                    <Field label="Job title" hint="e.g. Vice Principal">
                      <input className="input" maxLength={80} value={form.job_title} onChange={set("job_title")} />
                    </Field>
                  </div>
                  <Field label="Bio">
                    <textarea className="textarea" rows={3} value={form.bio} onChange={set("bio")} />
                  </Field>
                  <div className="tw-mt-2 tw-flex tw-gap-2">
                    <Button type="submit" disabled={busy === "account"}>
                      {busy === "account" ? "Saving..." : "Save details"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setForm(blank());
                        setEditing(false);
                      }}
                    >
                      {"Cancel"}
                    </Button>
                  </div>
                </form>
              </Card>
            ) : (
              <div className="tw-grid tw-grid-cols-2 tw-gap-4 mobile:tw-grid-cols-1">
                <Card icon={mail} title="Sign-in" action={!isSupport ? <LinkButton onClick={() => setEditing(true)}>{"Manage"}</LinkButton> : null}>
                  <Fact label="Email">{p.email ? <EmailLine email={p.email} /> : "No email"}</Fact>
                  <Fact label="Username">{p.username || <span className="tw-text-ink-3">{"Not set"}</span>}</Fact>
                  <Fact label="Last sign-in">
                    {status !== "offline" ? (
                      <span className="tw-font-semibold tw-text-success">{status === "away" ? "Away now" : "Online now"}</span>
                    ) : lastIn ? (
                      <>
                        <span className="tw-block">{relativeMoment(lastIn)}</span>
                        <span className="tw-block tw-text-[12.5px] tw-text-ink-3">{new Date(lastIn).toLocaleString()}</span>
                      </>
                    ) : (
                      <span className="tw-text-ink-3">{"Never signed in"}</span>
                    )}
                  </Fact>
                </Card>

                <Card icon={briefcase} title="At the school" action={<LinkButton onClick={() => setTab("role")}>{"Manage"}</LinkButton>}>
                  <Fact label="Role">
                    <span className="tw-flex tw-flex-wrap tw-gap-1">
                      {roles.map((r) => (
                        <RolePill key={r} role={r} />
                      ))}
                    </span>
                  </Fact>
                  <Fact label="Job title">{member.job_title || <span className="tw-text-ink-3">{"Not set"}</span>}</Fact>
                  {isStaff ? (
                    <Fact label="Reports to">
                      {manager ? (
                        <span className="tw-flex tw-items-center tw-gap-2">
                          <Avatar p={manager.profiles} size={24} />
                          {displayName(manager.profiles)}
                        </span>
                      ) : (
                        <span className="tw-text-ink-3">{"Nobody (top of the organisation)"}</span>
                      )}
                    </Fact>
                  ) : null}
                  <Fact label="Status">
                    {member.is_active ? <Chip tone="success">{"Active"}</Chip> : <Chip tone="danger">{"Suspended"}</Chip>}
                    <span className="tw-ml-2 tw-text-[12.5px] tw-text-ink-3">{`Added ${formatDate(member.created_at, { withTime: false })}`}</span>
                  </Fact>
                </Card>

                {isStaff && !isSupport ? (
                  <Card icon={shield} title="Module access" wide action={<LinkButton onClick={() => setTab("access")}>{"Manage"}</LinkButton>}>
                    {accessSummary.length ? (
                      <div className="tw-flex tw-flex-wrap tw-gap-2">
                        {accessSummary.map(([m, level]) => (
                          <Chip key={m} tone={level === "none" ? "danger" : level === "read" ? "warn" : "success"}>
                            {`${moduleById(m)?.label || m} · ${ACCESS_WORD[level] || level}`}
                          </Chip>
                        ))}
                      </div>
                    ) : (
                      <p className="tw-m-0 tw-text-[14px] tw-text-ink-2">{"Everything their role gives, nothing more and nothing less."}</p>
                    )}
                  </Card>
                ) : null}

                {isParent || isStudent ? (
                  <Card icon={usersIcon} title={isParent ? "Children" : "Parents"} wide action={<LinkButton onClick={() => setTab("family")}>{"Manage"}</LinkButton>}>
                    {links === null ? (
                      <p className="tw-m-0 tw-text-[14px] tw-text-ink-3">{"Loading..."}</p>
                    ) : links.length ? (
                      <div className="tw-flex tw-flex-wrap tw-gap-2">
                        {links.map((l) => {
                          const other = (isParent ? l.student : l.guardian) as PersonProfile;
                          return (
                            <span key={l.id} className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-bg-bg tw-py-1 tw-pl-1 tw-pr-3 tw-text-[13.5px] tw-text-ink">
                              <Avatar p={other} size={26} />
                              {displayName(other)}
                              {l.relationship ? <span className="tw-text-ink-3">{`· ${l.relationship}`}</span> : null}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="tw-m-0 tw-text-[14px] tw-text-ink-3">{isParent ? "No children linked yet." : "No parents linked yet."}</p>
                    )}
                  </Card>
                ) : null}

                {p.bio ? (
                  <Card icon={fileText} title="Bio" wide>
                    <p className="tw-m-0 tw-whitespace-pre-wrap tw-text-[14px] tw-leading-relaxed tw-text-ink-2">{p.bio}</p>
                  </Card>
                ) : null}
              </div>
            )
          ) : null}

          {tab === "role" ? (
            <div className="tw-flex tw-flex-col tw-gap-4">
              <Card icon={briefcase} title="Role">
                <Field label="Their role at the school" hint={isSelf ? "You cannot change your own role." : isSupport ? "Schoolivio support access is managed under Schoolivio access." : "It sets what they get by default; Access fine-tunes it."}>
                  <Select
                    value={member.role}
                    disabled={isSelf || isSupport || Boolean(busy)}
                    onChange={(v) => act("role", () => updateMemberRole({ schoolId, memberId: member.id, role: v }), `${name} is now ${ROLE_LABEL[v]}.`)}
                    options={ROLES.map(([value, label]) => ({ value, label }))}
                  />
                </Field>
              </Card>
              {isStaff ? (
                <Card icon={usersIcon} title="Reporting line">
                  <Field label="Reports to" hint="Their manager on the org chart.">
                    <Select
                      searchable
                      value={member.manager_id || ""}
                      disabled={isSupport || Boolean(busy)}
                      onChange={(v) =>
                        act(
                          "manager",
                          () => updateMemberManager({ schoolId, memberId: member.id, managerId: v || null }),
                          v ? `${name} now reports to ${displayName(members.find((m) => m.user_id === v)?.profiles as PersonProfile)}.` : `${name} now reports to nobody.`
                        )
                      }
                      options={managerOptions}
                    />
                  </Field>
                  <Fact label={`Reporting to ${name} (${reportsToThem.length})`}>
                    {reportsToThem.length ? (
                      <ul className="tw-m-0 tw-mt-1 tw-list-none tw-p-0">
                        {reportsToThem.map((m) => (
                          <PersonRow key={m.user_id} p={m.profiles} sub={[m.job_title, ROLE_LABEL[m.role]].filter(Boolean).join(" · ")} />
                        ))}
                      </ul>
                    ) : (
                      <span className="tw-text-ink-3">{"Nobody reports to them."}</span>
                    )}
                  </Fact>
                </Card>
              ) : (
                <p className="tw-m-0 tw-text-[13.5px] tw-text-ink-3">{"Parents and pupils are not on the org chart."}</p>
              )}
            </div>
          ) : null}

          {tab === "access" ? (
            <Card icon={shield} title="Module access">
              <p className="tw-m-0 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
                {"Their role sets what they get; change any of it here. No access hides the module, View only lets them look, Can edit lets them make changes too."}
              </p>
              <div className="tw-overflow-hidden tw-rounded-xl tw-border tw-border-solid tw-border-line">
                {settable.map((id) => {
                  const covered = roleCovers(id, roles);
                  const options = covered
                    ? [
                        { value: "", label: "Can edit (with their role)" },
                        { value: "read", label: "View only" },
                        { value: "none", label: "No access" },
                      ]
                    : [
                        { value: "edit", label: ACCESS_LABEL.edit },
                        { value: "read", label: ACCESS_LABEL.read },
                        { value: "", label: "No access" },
                      ];
                  const value = normalised(id, access[id] || "");
                  const ownSchoolAdmin = id === "school" && isSelf;
                  const changed = value !== "";
                  return (
                    <div
                      key={id}
                      className={`tw-flex tw-items-center tw-justify-between tw-gap-4 tw-px-4 tw-py-2.5 tw-border-0 tw-border-b tw-border-solid tw-border-line last:tw-border-b-0 ${changed ? "tw-bg-brand-soft" : ""}`}
                    >
                      <span className="tw-flex tw-min-w-0 tw-flex-col">
                        <span className={`tw-text-[14px] ${changed ? "tw-font-semibold tw-text-brand" : "tw-text-ink"}`}>{moduleById(id)?.label || id}</span>
                        <small className="tw-text-[12px] tw-text-ink-3">{covered ? "With their role" : "Not in their role"}</small>
                      </span>
                      <div className="tw-w-[210px] tw-shrink-0 mobile:tw-w-[165px]">
                        <Select
                          value={value}
                          disabled={ownSchoolAdmin}
                          title={ownSchoolAdmin ? "You cannot limit your own School admin access." : undefined}
                          onChange={(v) => setAccess((a) => ({ ...a, [id]: v }))}
                          options={options}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="tw-flex tw-gap-2">
                <Button type="button" disabled={!accessChanged || busy === "access"} onClick={saveAccess}>
                  {busy === "access" ? "Saving..." : "Save access"}
                </Button>
                {accessChanged ? (
                  <Button type="button" variant="secondary" onClick={() => setAccess(Object.fromEntries(settable.map((id) => [id, mine[id] || ""])))}>
                    {"Undo changes"}
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : null}

          {tab === "family" ? (
            <div className="tw-flex tw-flex-col tw-gap-4">
              <Card icon={usersIcon} title={isParent ? `${name}'s children` : `${name}'s parents`}>
                <p className="tw-m-0 tw-text-[13.5px] tw-text-ink-2">
                  {isParent ? "Children this parent can see: their bills, reports, attendance and news." : "Parents who can see this pupil's bills, reports, attendance and news."}
                </p>
                {links === null ? (
                  <p className="tw-m-0 tw-text-[13.5px] tw-text-ink-3">{"Loading..."}</p>
                ) : links.length ? (
                  <ul className="tw-m-0 tw-list-none tw-p-0">
                    {links.map((l) => {
                      const other = (isParent ? l.student : l.guardian) as PersonProfile;
                      return (
                        <PersonRow
                          key={l.id}
                          p={other}
                          sub={[l.relationship, other.email].filter(Boolean).join(" · ")}
                          action={
                            <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => removeLink(l)}>
                              {"Unlink"}
                            </Button>
                          }
                        />
                      );
                    })}
                  </ul>
                ) : (
                  <p className="tw-m-0 tw-rounded-xl tw-border tw-border-dashed tw-border-line tw-px-4 tw-py-6 tw-text-center tw-text-[13.5px] tw-text-ink-3">
                    {isParent ? "No children linked yet." : "No parents linked yet."}
                  </p>
                )}
              </Card>
              <Card icon={userCheck} title={isParent ? "Link a child" : "Link a parent"}>
                <div className="tw-grid tw-grid-cols-[1fr_180px] tw-gap-3 mobile:tw-grid-cols-1">
                  <Field label={isParent ? "Pupil" : "Parent"}>
                    <Select
                      searchable
                      value={linkWho}
                      placeholder={linkCandidates.length ? (isParent ? "Choose a pupil" : "Choose a parent") : isParent ? "No other pupils to link" : "No other parents to link"}
                      onChange={setLinkWho}
                      options={linkCandidates}
                    />
                  </Field>
                  <Field label="Relationship">
                    <input className="input" value={linkRel} maxLength={40} placeholder="e.g. Mother" onChange={(e) => setLinkRel(e.target.value)} />
                  </Field>
                </div>
                <div>
                  <Button type="button" disabled={!linkWho || Boolean(busy)} onClick={addLink}>
                    {busy === "link" ? "Linking..." : "Link"}
                  </Button>
                </div>
              </Card>
            </div>
          ) : null}

          {tab === "pupil" ? (
            registration === undefined ? (
              <p className="tw-m-0 tw-text-[13.5px] tw-text-ink-3">{"Loading..."}</p>
            ) : registration ? (
              <Card icon={fileText} title="Pupil record" action={registration.application_id ? <LinkButton onClick={() => window.location.assign(`/Admissions/${registration.application_id}`)}>{"Open application"}</LinkButton> : null}>
                <div className="tw-grid tw-grid-cols-2 tw-gap-4 mobile:tw-grid-cols-1">
                  <Fact label="Registration number">
                    <span className="tw-font-mono tw-text-[15px]">{registration.registration_number || "—"}</span>
                  </Fact>
                  <Fact label="Class">{registration.class?.name || <span className="tw-text-ink-3">{"Not placed yet"}</span>}</Fact>
                  <Fact label="Status">
                    <Chip tone={registration.status === "active" ? "success" : "muted"}>{registration.status || "—"}</Chip>
                  </Fact>
                  <Fact label="Registered">{registration.registered_at ? formatDate(registration.registered_at, { withTime: false }) : "—"}</Fact>
                </div>
                <Fact label="Parents">{familyNames}</Fact>
              </Card>
            ) : (
              <Card icon={fileText} title="Pupil record">
                <p className="tw-m-0 tw-text-[13.5px] tw-text-ink-3">{"No registration record: they were added as a pupil directly, not through admissions."}</p>
              </Card>
            )
          ) : null}
        </div>
      </aside>
    </div>,
    document.body
  );
};

export default PersonPanel;
