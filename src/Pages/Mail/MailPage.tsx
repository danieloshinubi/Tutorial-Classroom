import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { Button, Modal, Select } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import { subscribeToMail } from "../../lib/api";
import {
  FOLDERS,
  deleteForever,
  directory,
  formatBytes,
  canSend,
  listContacts,
  listFolder,
  loadMailbox,
  loadMessage,
  mailGroups,
  moveTo,
  myMailboxes,
  setFlags,
  unreadCounts,
  type Address,
  type DirectoryEntry,
  type Folder,
  type Mailbox,
  type MailboxChoice,
  type MailMessage,
  type MailSummary,
} from "../../lib/mailApi";
import Compose, { sendSummary, type ComposeStart } from "./Compose";
import Reader from "./Reader";
import ImportMail from "./ImportMail";
import Contacts from "./Contacts";
import MailSettingsModal from "./MailSettingsModal";
import { onPendingSends, sendNow, undoSend, type PendingSend } from "./sendQueue";
import { ICON, Initials, Svg, btn, names, primaryBtn, shortWhen } from "./mailUi";

// Schoolivio Mail (supabase/235), laid out like Outlook: folders on the left,
// the folder's messages in the middle, the open conversation or the message
// being written on the right. On a phone it is one column at a time. Mail
// arrives, is read and is filed live. Also (supabase/241): contacts and
// groups, settings (signature, automatic replies, undo send, opened alerts),
// the undo-send bar, and opening a conversation from a notification link
// (/Mail?thread=…&folder=…).

// "Sending… Undo": a message waiting its few seconds before it really goes.
const UndoBar = ({ onUndo }: { onUndo: (draftId: string) => void }) => {
  const { setError, setNotice } = useActionFeedback();
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [, tick] = useState(0);
  useEffect(() => onPendingSends(setPending), []);
  useEffect(() => {
    if (!pending.length) return undefined;
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, [pending.length]);
  if (!pending.length) return null;
  return (
    <div className="tw-fixed tw-bottom-5 tw-left-1/2 tw-z-[180] tw-flex tw--translate-x-1/2 tw-flex-col tw-gap-2">
      {pending.map((p) => (
        <div key={p.draftId} className="tw-flex tw-items-center tw-gap-3 tw-rounded-xl tw-bg-ink tw-px-4 tw-py-2.5 tw-text-[13.5px] tw-text-white tw-shadow-3">
          <span className="tw-max-w-[260px] tw-truncate">{`Sending "${p.subject}"… ${Math.max(0, Math.ceil((p.until - Date.now()) / 1000))}s`}</span>
          <button
            type="button"
            className="tw-rounded-md tw-border-0 tw-bg-white/15 tw-px-2.5 tw-py-1 tw-text-[13px] tw-font-semibold tw-text-white tw-cursor-pointer hover:tw-bg-white/25 [font-family:inherit]"
            onClick={() => {
              if (undoSend(p.draftId)) onUndo(p.draftId);
            }}
          >
            {"Undo"}
          </button>
          <button
            type="button"
            className="tw-rounded-md tw-border-0 tw-bg-transparent tw-px-1.5 tw-py-1 tw-text-[12.5px] tw-text-white/80 tw-cursor-pointer hover:tw-text-white [font-family:inherit]"
            onClick={() => sendNow(p.draftId, (r) => setNotice(sendSummary(r)), (err) => setError(`Not sent: ${err.message} It is in your Drafts.`))}
          >
            {"Send now"}
          </button>
        </div>
      ))}
    </div>
  );
};

type Filter = "all" | "unread" | "flagged";

const SHORTCUTS: [string, string][] = [
  ["N", "New mail"],
  ["R", "Reply"],
  ["A", "Reply all"],
  ["F", "Forward"],
  ["E", "Archive"],
  ["# or Del", "Delete"],
  ["U", "Mark as unread"],
  ["J / K", "Next / previous conversation"],
  ["/", "Search"],
  ["Esc", "Close the conversation"],
  ["Ctrl+Enter", "Send (while writing)"],
  ["?", "Show these shortcuts"],
];

const FOLDER_ICON: Record<Folder, string> = {
  inbox: ICON.inbox,
  drafts: ICON.drafts,
  sent: ICON.sent,
  outbox: ICON.outbox,
  archive: ICON.archive,
  junk: ICON.junk,
  deleted: ICON.deleted,
};

// The Mail page fills the window under the top bar and the page itself does
// not scroll: each column scrolls on its own, as in a mail app.
const useFullHeight = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let page: HTMLElement | null = null;
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (/(auto|scroll)/.test(window.getComputedStyle(node).overflowY)) {
        page = node;
        break;
      }
    }
    const target = page || (document.scrollingElement as HTMLElement | null) || document.documentElement;
    const before = target.style.overflowY;
    // The area actually visible: on a phone the browser's bars come and go
    // and the keyboard covers the bottom, so window.innerHeight is not it.
    // (On a phone the page is also framed to that area, theme.css "Mail on a
    // phone", so the top bar and each pane's own header never move.)
    const fit = () => {
      target.scrollTop = 0;
      target.style.overflowY = "hidden";
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const phone = window.matchMedia?.("(max-width: 900px)").matches;
      setHeight(Math.max(phone ? 200 : 420, Math.floor(bottom - el.getBoundingClientRect().top - (phone ? 0 : 12))));
    };
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    // The top bar stepping aside while typing on a phone resizes the page
    // area without resizing the window.
    const observer = typeof ResizeObserver === "undefined" || !el.parentElement ? null : new ResizeObserver(() => fit());
    if (observer && el.parentElement) observer.observe(el.parentElement);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      target.style.overflowY = before;
    };
  }, []);
  return { ref, height };
};

const MailPage = () => {
  const { user } = useAuth();
  const { schoolId } = useSchool();
  const { setError, setNotice } = useActionFeedback();
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  // My own mailbox and the shared ones I can open (supabase/242).
  const [boxes, setBoxes] = useState<MailboxChoice[]>([]);
  const [people, setPeople] = useState<DirectoryEntry[]>([]);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [items, setItems] = useState<MailSummary[] | null>(null);
  const [liveTick, setLiveTick] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<Folder, number>>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [compose, setCompose] = useState<(ComposeStart & { key: number }) | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [view, setView] = useState<"mail" | "contacts">("mail");
  const [contactStart, setContactStart] = useState<Address | null>(null);
  const [extra, setExtra] = useState<DirectoryEntry[]>([]);
  const [keysOpen, setKeysOpen] = useState(false);
  const searchBox = useRef<HTMLInputElement | null>(null);
  const full = useFullHeight();

  // The mailbox, made the first time it is opened; a notification link may
  // name a shared one (&box=…).
  useEffect(() => {
    if (!schoolId) return;
    myMailboxes(schoolId)
      .then(async (list) => {
        setBoxes(list);
        const wanted = new URLSearchParams(window.location.search).get("box");
        const pick = list.find((b) => b.id === wanted) ?? list[0];
        if (pick) setMailbox(await loadMailbox(pick.id));
      })
      .catch((err: Error) => setError(err.message));
    directory(schoolId).then(setPeople).catch(() => undefined);
  }, [schoolId, setError]);

  // Suggestions while typing: staff, then your contacts and the groups.
  const loadSuggestions = useCallback(async () => {
    if (!mailbox || !schoolId) return;
    try {
      const [contacts, groups] = await Promise.all([listContacts(mailbox.id), mailGroups(schoolId)]);
      setExtra([
        ...groups.map((g) => ({ address: g.address, name: g.name, job_title: `Group · ${g.members} ${g.members === 1 ? "person" : "people"}`, avatar_url: null })),
        ...contacts.map((c) => ({ address: c.address, name: c.name || c.address, job_title: c.company || "Contact", avatar_url: null })),
      ]);
    } catch {
      setExtra([]);
    }
  }, [mailbox, schoolId]);
  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);
  const suggest = useMemo(() => [...people, ...extra.filter((e) => !people.some((p) => p.address === e.address))], [people, extra]);

  // Opened from a notification: /Mail?thread=…&folder=…&box=…, also while
  // Mail is already open (the "opened" pop-up, the bell).
  const { search: query } = useLocation();
  useEffect(() => {
    const q = new URLSearchParams(query);
    const thread = q.get("thread");
    const f = q.get("folder") as Folder | null;
    const box = q.get("box");
    (async () => {
      // The first load picks &box itself; later links switch to it here.
      if (box && mailbox && box !== mailbox.id) {
        try {
          setMailbox(await loadMailbox(box));
        } catch (err) {
          setError((err as Error).message);
          return;
        }
      }
      if (f && FOLDERS.some((x) => x.id === f)) setFolder(f);
      if (thread) {
        setCompose(null);
        setView("mail");
        setOpenThread(thread);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const refreshBoxes = useCallback(() => {
    if (schoolId) myMailboxes(schoolId).then(setBoxes).catch(() => undefined);
  }, [schoolId]);

  const switchTo = async (id: string) => {
    if (id === mailbox?.id) return;
    try {
      setMailbox(await loadMailbox(id));
      setFolder("inbox");
      setOpenThread(null);
      setCompose(null);
      setView("mail");
      setFilter("all");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Only the newest load lands: Inbox answering after Sent was picked must
  // not fill Sent with Inbox mail.
  const loadSeq = useRef(0);
  const reload = useCallback(async () => {
    if (!mailbox) return;
    const n = ++loadSeq.current;
    try {
      const [list, c] = await Promise.all([listFolder(mailbox.id, folder, search), unreadCounts(mailbox.id)]);
      if (n !== loadSeq.current) return;
      setItems(list);
      setCounts(c);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [mailbox, folder, search, setError]);

  useEffect(() => {
    setItems(null);
    const t = window.setTimeout(reload, search ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [reload, search]);

  // Live: new mail, and anything read or filed on another device.
  useEffect(() => {
    if (!user?.id) return undefined;
    const sub = subscribeToMail(user.id, () => {
      reload();
      refreshBoxes();
      setLiveTick((n) => n + 1);
    });
    return () => sub.unsubscribe();
  }, [user?.id, reload, refreshBoxes]);

  const access = boxes.find((b) => b.id === mailbox?.id)?.access;
  const readOnly = access === "read";
  // Settings, rules and safe/blocked senders: my own mailbox, or full access.
  const canManage = !access || access === "own" || access === "full";

  // One row per conversation, newest first; pinned ones on top.
  const rows = useMemo(() => {
    if (!items) return null;
    const byThread = new Map<string, { latest: MailSummary; count: number; unread: boolean; flagged: boolean; files: boolean; pinned: boolean; ids: MailSummary[] }>();
    items.forEach((m) => {
      const key = folder === "drafts" ? m.id : m.thread_id;
      const t = byThread.get(key);
      if (!t) byThread.set(key, { latest: m, count: 1, unread: !m.is_read, flagged: m.is_flagged, files: m.has_attachments, pinned: m.is_pinned, ids: [m] });
      else {
        t.count += 1;
        t.unread = t.unread || !m.is_read;
        t.flagged = t.flagged || m.is_flagged;
        t.files = t.files || m.has_attachments;
        t.pinned = t.pinned || m.is_pinned;
        t.ids.push(m);
      }
    });
    let list = Array.from(byThread.values());
    if (filter === "unread") list = list.filter((t) => t.unread);
    if (filter === "flagged") list = list.filter((t) => t.flagged);
    return list.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [items, filter, folder]);

  const startCompose = (start: ComposeStart) => {
    setView("mail");
    setOpenThread(null);
    setCompose({ ...start, key: Date.now() });
  };

  const openRow = async (r: { latest: MailSummary }) => {
    if (folder === "drafts") {
      try {
        startCompose({ mode: "draft", draft: await loadMessage(r.latest.id) });
      } catch (err) {
        setError((err as Error).message);
      }
      return;
    }
    setCompose(null);
    setOpenThread(r.latest.thread_id);
  };

  // Keyboard shortcuts (supabase/243), as in Outlook and Gmail. Never while
  // typing, and never with a dialog or a message being written open.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (keysOpen) {
      if (e.key === "Escape" || e.key === "?") setKeysOpen(false);
      return;
    }
    if (settingsOpen || importOpen || compose || document.querySelector("[role='dialog']")) return;
    const step = (by: number) => {
      if (!rows?.length || view !== "mail") return;
      const at = rows.findIndex((r) => (folder === "drafts" ? r.latest.id : r.latest.thread_id) === openThread);
      const next = rows[Math.min(rows.length - 1, Math.max(0, at < 0 ? 0 : at + by))];
      if (next) openRow(next);
    };
    const toReader: Record<string, string> = { r: "reply", a: "replyAll", f: "forward", e: "archive", "#": "delete", Delete: "delete", u: "unread" };
    let handled = true;
    if (e.key === "?") setKeysOpen(true);
    else if (e.key === "n" && mailbox && !readOnly && mailbox.is_active !== false) startCompose({ mode: "new" });
    else if (e.key === "/") searchBox.current?.focus();
    else if (e.key === "j") step(1);
    else if (e.key === "k") step(-1);
    else if (e.key === "Escape" && (openThread || view === "contacts")) {
      setOpenThread(null);
      setView("mail");
    } else if (toReader[e.key] && openThread) window.dispatchEvent(new CustomEvent("mail:shortcut", { detail: toReader[e.key] }));
    else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const quick = async (work: () => Promise<unknown>) => {
    try {
      await work();
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const used = mailbox ? Math.min(100, (mailbox.used_bytes / mailbox.quota_bytes) * 100) : 0;
  const showingRight = Boolean(compose || openThread || view === "contacts");

  return (
    <div className="shell">
      <Navbar />
      <div className="page-mail tw-px-4 tw-pt-3 mobile:tw-px-0 mobile:tw-pt-0">
      <div ref={full.ref} className="tw-flex tw-overflow-hidden tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-shadow-1 [font-family:inherit] mobile:tw-rounded-none mobile:tw-border-0" style={{ height: full.height || 640 }}>
        {/* Folders */}
        <aside className="tw-flex tw-w-[230px] tw-shrink-0 tw-flex-col tw-border-0 tw-border-r tw-border-solid tw-border-line tw-bg-bg mobile:tw-hidden">
          <div className="tw-p-3">
            <button type="button" className={`${primaryBtn} tw-w-full tw-justify-center`} disabled={!mailbox || readOnly || mailbox.is_active === false} onClick={() => startCompose({ mode: "new" })}>
              <Svg d={ICON.compose} size={16} />
              {"New mail"}
            </button>
          </div>
          {boxes.length > 1 ? (
            <div className="tw-px-2 tw-pb-2">
              <p className="tw-m-0 tw-px-3 tw-pb-1 tw-text-[11.5px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">{"Mailboxes"}</p>
              {boxes.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => switchTo(b.id)}
                  title={b.address}
                  className={`tw-mb-0.5 tw-flex tw-w-full tw-items-center tw-gap-2 tw-rounded-lg tw-border-0 tw-px-3 tw-py-1.5 tw-text-left tw-text-[13.5px] tw-cursor-pointer [font-family:inherit] ${
                    b.id === mailbox?.id ? "tw-bg-surface tw-font-semibold tw-text-ink tw-shadow-1" : "tw-bg-transparent tw-text-ink-2 hover:tw-bg-surface"
                  }`}
                >
                  <Svg d={b.kind === "shared" ? ICON.users : ICON.envelope} size={14} />
                  <span className="tw-min-w-0 tw-flex-1 tw-truncate">{b.kind === "person" ? "My mailbox" : b.display_name}</span>
                  {b.access === "read" ? <span className="tw-text-[11px] tw-text-ink-3">{"read"}</span> : null}
                  {b.unread ? <span className="tw-text-[12px] tw-font-bold tw-text-brand">{b.unread}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          <nav className="tw-flex-1 tw-overflow-y-auto tw-px-2">
            {FOLDERS.map((f) => {
              const n = counts[f.id];
              const on = folder === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setView("mail");
                    setFolder(f.id);
                    setOpenThread(null);
                    setFilter("all");
                  }}
                  className={`tw-mb-0.5 tw-flex tw-w-full tw-items-center tw-gap-3 tw-rounded-lg tw-border-0 tw-px-3 tw-py-2 tw-text-left tw-text-[14px] tw-cursor-pointer tw-transition-colors [font-family:inherit] ${
                    on && view === "mail" ? "tw-bg-brand-soft tw-font-semibold tw-text-brand" : "tw-bg-transparent tw-text-ink hover:tw-bg-surface"
                  }`}
                >
                  <Svg d={FOLDER_ICON[f.id]} size={16} />
                  <span className="tw-flex-1">{f.label}</span>
                  {n ? <span className={`tw-text-[12.5px] ${f.id === "inbox" || f.id === "junk" ? "tw-font-bold tw-text-brand" : "tw-text-ink-3"}`}>{n}</span> : null}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setContactStart(null);
                setView("contacts");
                setCompose(null);
              }}
              className={`tw-mt-2 tw-flex tw-w-full tw-items-center tw-gap-3 tw-rounded-lg tw-border-0 tw-px-3 tw-py-2 tw-text-left tw-text-[14px] tw-cursor-pointer tw-transition-colors [font-family:inherit] ${
                view === "contacts" ? "tw-bg-brand-soft tw-font-semibold tw-text-brand" : "tw-bg-transparent tw-text-ink hover:tw-bg-surface"
              }`}
            >
              <Svg d={ICON.users} size={16} />
              <span className="tw-flex-1">{"Contacts"}</span>
            </button>
          </nav>
          {mailbox ? (
            <div className="tw-border-0 tw-border-t tw-border-solid tw-border-line tw-p-3">
              <div className="tw-truncate tw-text-[12.5px] tw-font-semibold tw-text-ink" title={mailbox.address}>
                {mailbox.address}
              </div>
              <div className="tw-mt-2 tw-h-1.5 tw-overflow-hidden tw-rounded-full tw-bg-line">
                <div className={`tw-h-full tw-rounded-full ${used > 90 ? "tw-bg-danger" : "tw-bg-brand"}`} style={{ width: `${Math.max(used, 1)}%` }} />
              </div>
              <div className="tw-mt-1 tw-text-[11.5px] tw-text-ink-3">{`${formatBytes(mailbox.used_bytes)} of ${formatBytes(mailbox.quota_bytes)} used`}</div>
              {canManage ? (
                <button type="button" className={`${btn} tw-mt-2 tw--ml-2 tw-text-[13px]`} onClick={() => setSettingsOpen(true)}>
                  <Svg d={ICON.settings} size={14} />
                  {mailbox.autoreply_enabled ? "Settings (away)" : "Settings"}
                </button>
              ) : null}
              <button type="button" className={`${btn} tw--ml-2 tw-text-[13px]`} onClick={() => setImportOpen(true)}>
                <Svg d={ICON.archive} size={14} />
                {"Import old mail"}
              </button>
              <button type="button" className={`${btn} tw--ml-2 tw-text-[13px]`} onClick={() => setKeysOpen(true)}>
                <Svg d={ICON.keyboard} size={14} />
                {"Keyboard shortcuts"}
              </button>
            </div>
          ) : null}
        </aside>

        {/* Messages */}
        <section className={`tw-flex tw-w-[380px] tw-shrink-0 tw-flex-col tw-border-0 tw-border-r tw-border-solid tw-border-line mobile:tw-w-full ${showingRight ? "mobile:tw-hidden" : ""}`}>
          <div className="tw-border-0 tw-border-b tw-border-solid tw-border-line tw-p-3">
            {/* On a phone: the folder and New mail, above the list. */}
            <div className="tw-mb-2 tw-hidden tw-items-center tw-gap-2 mobile:tw-flex">
              <div className="tw-flex-1">
                <Select
                  value={folder}
                  onChange={(v) => {
                    setFolder(v as Folder);
                    setOpenThread(null);
                    setFilter("all");
                  }}
                  options={FOLDERS.map((f) => ({ value: f.id, label: counts[f.id] ? `${f.label} (${counts[f.id]})` : f.label }))}
                />
              </div>
              {boxes.length > 1 ? (
                <div className="tw-w-[130px]">
                  <Select
                    value={mailbox?.id || ""}
                    onChange={(v) => switchTo(v)}
                    options={boxes.map((b) => ({ value: b.id, label: b.kind === "person" ? "My mailbox" : b.display_name }))}
                  />
                </div>
              ) : null}
              <button type="button" className={primaryBtn} disabled={!mailbox || readOnly} onClick={() => startCompose({ mode: "new" })}>
                <Svg d={ICON.compose} size={15} />
                {"New"}
              </button>
            </div>
            <div className="tw-mb-2 tw-flex tw-items-center tw-justify-between">
              <h2 className="tw-m-0 tw-text-[17px] tw-font-bold tw-text-ink mobile:tw-hidden">{FOLDERS.find((f) => f.id === folder)?.label}</h2>
              <div className="tw-flex tw-gap-1 tw-rounded-full tw-bg-bg tw-p-0.5">
                {(["all", "unread", "flagged"] as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`tw-rounded-full tw-border-0 tw-px-2.5 tw-py-1 tw-text-[12.5px] tw-cursor-pointer [font-family:inherit] ${filter === f ? "tw-bg-surface tw-font-semibold tw-text-brand tw-shadow-1" : "tw-bg-transparent tw-text-ink-2"}`}
                  >
                    {f === "all" ? "All" : f === "unread" ? "Unread" : "Flagged"}
                  </button>
                ))}
              </div>
            </div>
            <label className="tw-flex tw-h-9 tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3">
              <span className="tw-text-ink-3"><Svg d={ICON.search} size={14} /></span>
              <input
                ref={searchBox}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${FOLDERS.find((f) => f.id === folder)?.label.toLowerCase()}`}
                className="tw-h-full tw-w-full tw-border-0 tw-bg-transparent tw-text-[14px] tw-text-ink tw-outline-none [font-family:inherit]"
              />
            </label>
          </div>
          <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto">
            {rows === null ? (
              <p className="tw-m-0 tw-p-6 tw-text-[14px] tw-text-ink-3">{"Loading…"}</p>
            ) : rows.length === 0 ? (
              <div className="tw-flex tw-flex-col tw-items-center tw-gap-2 tw-px-6 tw-py-16 tw-text-center tw-text-ink-3">
                <Svg d={FOLDER_ICON[folder]} size={34} />
                <p className="tw-m-0 tw-text-[14px]">{search ? "Nothing matches your search." : filter !== "all" ? `Nothing ${filter} here.` : "Nothing here yet."}</p>
              </div>
            ) : (
              rows.map((r) => {
                const m = r.latest;
                const isOpen = openThread === m.thread_id || (folder === "drafts" && compose?.draft?.id === m.id);
                const who = folder === "sent" || folder === "drafts" || folder === "outbox" ? `To: ${names(m.to_list) || "(no recipient)"}` : m.from_name || m.from_address;
                return (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openRow(r)}
                    onKeyDown={(e) => (e.key === "Enter" ? openRow(r) : undefined)}
                    className={`tw-group tw-relative tw-flex tw-cursor-pointer tw-gap-3 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-3 tw-py-3 tw-transition-colors focus:tw-outline-none ${
                      isOpen ? "tw-bg-brand-soft" : "hover:tw-bg-bg"
                    }`}
                  >
                    {r.unread ? <span className="tw-absolute tw-left-0 tw-top-0 tw-h-full tw-w-[3px] tw-bg-brand" /> : null}
                    <Initials name={folder === "sent" || folder === "drafts" ? m.to_list[0]?.name : m.from_name} address={folder === "sent" || folder === "drafts" ? m.to_list[0]?.address || "?" : m.from_address} size={36} />
                    <div className="tw-min-w-0 tw-flex-1">
                      <div className="tw-flex tw-items-baseline tw-gap-2">
                        <span className={`tw-min-w-0 tw-flex-1 tw-truncate tw-text-[14px] ${r.unread ? "tw-font-bold tw-text-ink" : "tw-text-ink"}`}>{who}</span>
                        {r.count > 1 ? <span className="tw-text-[12px] tw-text-ink-3">{r.count}</span> : null}
                        <span className={`tw-shrink-0 tw-text-[12px] ${r.unread ? "tw-font-semibold tw-text-brand" : "tw-text-ink-3"}`}>{shortWhen(m.sent_at || m.created_at)}</span>
                      </div>
                      <div className="tw-flex tw-items-center tw-gap-1.5">
                        {m.importance === "high" ? <span className="tw-text-[13px] tw-font-bold tw-text-danger">{"!"}</span> : null}
                        <span className={`tw-min-w-0 tw-flex-1 tw-truncate tw-text-[13.5px] ${r.unread ? "tw-font-semibold tw-text-ink" : "tw-text-ink-2"}`}>{m.subject || "(no subject)"}</span>
                        {r.files ? <span className="tw-text-ink-3"><Svg d={ICON.clip} size={13} /></span> : null}
                        {r.flagged ? <span className="tw-text-danger"><Svg d={ICON.flag} size={13} fill /></span> : null}
                        {r.pinned ? <span className="tw-text-brand"><Svg d={ICON.pin} size={13} /></span> : null}
                        {m.scheduled_at ? (
                          <span className="tw-shrink-0 tw-rounded-full tw-bg-brand-soft tw-px-1.5 tw-text-[11px] tw-font-semibold tw-text-brand">
                            {`Sends ${shortWhen(m.scheduled_at)}`}
                          </span>
                        ) : null}
                        {m.recalled_at ? <span className="tw-shrink-0 tw-text-[11px] tw-font-semibold tw-text-warn-ink">{"Recalled"}</span> : null}
                      </div>
                      <div className="tw-truncate tw-text-[13px] tw-text-ink-3">{m.snippet || " "}</div>
                    </div>
                    {/* Quick actions on hover */}
                    {folder !== "drafts" ? (
                      <div className="tw-absolute tw-bottom-2 tw-right-2 tw-hidden tw-gap-0.5 tw-rounded-lg tw-bg-surface tw-p-0.5 tw-shadow-2 group-hover:tw-flex mobile:tw-hidden">
                        <button
                          type="button"
                          title={r.unread ? "Mark as read" : "Mark as unread"}
                          className={`${btn} tw-px-1.5 tw-py-1`}
                          onClick={(e) => {
                            e.stopPropagation();
                            quick(() => setFlags(r.ids.map((x) => x.id), { is_read: r.unread }));
                          }}
                        >
                          <Svg d={r.unread ? ICON.envelopeOpen : ICON.envelope} size={14} />
                        </button>
                        <button
                          type="button"
                          title={r.flagged ? "Clear flag" : "Flag"}
                          className={`${btn} tw-px-1.5 tw-py-1 ${r.flagged ? "tw-text-danger" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            quick(() => setFlags(r.ids.map((x) => x.id), { is_flagged: !r.flagged }));
                          }}
                        >
                          <Svg d={ICON.flag} size={14} fill={r.flagged} />
                        </button>
                        <button
                          type="button"
                          title={r.pinned ? "Unpin" : "Pin to the top"}
                          className={`${btn} tw-px-1.5 tw-py-1 ${r.pinned ? "tw-text-brand" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            quick(() => setFlags(r.ids.map((x) => x.id), { is_pinned: !r.pinned }));
                          }}
                        >
                          <Svg d={ICON.pin} size={14} />
                        </button>
                        <button
                          type="button"
                          title={folder === "deleted" ? "Delete forever" : "Delete"}
                          className={`${btn} tw-px-1.5 tw-py-1 tw-text-danger`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (openThread === m.thread_id) setOpenThread(null);
                            quick(() => (folder === "deleted" ? deleteForever(r.ids.map((x) => x.id)) : moveTo(r.ids, "deleted")));
                          }}
                        >
                          <Svg d={ICON.deleted} size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Reading pane / compose */}
        <main className={`tw-flex tw-min-w-0 tw-flex-1 tw-flex-col ${showingRight ? "" : "mobile:tw-hidden"}`}>
          {showingRight ? (
            <div className="tw-hidden tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-2 tw-py-1.5 mobile:tw-block">
              <button
                type="button"
                className={btn}
                onClick={() => {
                  setOpenThread(null);
                  setCompose(null);
                }}
              >
                <Svg d={ICON.back} size={16} />
                {"Back"}
              </button>
            </div>
          ) : null}
          {view === "contacts" && mailbox ? (
            <Contacts
              key={contactStart?.address || "contacts"}
              mailboxId={mailbox.id}
              people={people}
              start={contactStart}
              onWrite={(to) => {
                setView("mail");
                setOpenThread(null);
                setCompose({ mode: "new", key: Date.now(), to });
              }}
              onChanged={loadSuggestions}
            />
          ) : compose && mailbox ? (
            <Compose
              key={compose.key}
              mailbox={mailbox}
              fromChoices={boxes.filter((b) => canSend(b.access))}
              people={suggest}
              start={compose}
              onClose={() => setCompose(null)}
              onSaved={reload}
            />
          ) : openThread && mailbox ? (
            <Reader
              key={openThread}
              mailboxId={mailbox.id}
              myAddress={mailbox.address}
              folder={folder}
              threadId={openThread}
              onCompose={(mode, source: MailMessage) => startCompose({ mode, source })}
              onChanged={reload}
              onClosed={() => setOpenThread(null)}
              liveTick={liveTick}
              readOnly={readOnly}
              canTrust={canManage}
              onAddContact={(a) => {
                setContactStart(a);
                setView("contacts");
              }}
            />
          ) : (
            <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-bg-bg tw-text-center tw-text-ink-3">
              <span className="tw-inline-flex tw-h-16 tw-w-16 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-soft tw-text-brand">
                <Svg d={ICON.envelope} size={28} />
              </span>
              {mailbox && mailbox.is_active === false ? (
                <>
                  <p className="tw-m-0 tw-text-[15px] tw-font-semibold tw-text-ink">{"This mailbox is suspended"}</p>
                  <p className="tw-m-0 tw-max-w-[360px] tw-text-[13.5px]">{"The school admin has paused it: nothing can be sent or received for now. Please speak to them."}</p>
                </>
              ) : (
                <>
                  <p className="tw-m-0 tw-text-[15px] tw-font-semibold tw-text-ink">{"Select a message to read"}</p>
                  <p className="tw-m-0 tw-text-[13.5px]">{mailbox ? `${mailbox.kind === "shared" ? "Shared mailbox" : "Your address"}: ${mailbox.address}${readOnly ? " (read only)" : ""}` : "Opening your mailbox…"}</p>
                </>
              )}
            </div>
          )}
        </main>
      </div>
      </div>

      {importOpen && mailbox ? (
        <Modal
          title="Import old mail"
          subtitle="Bring your mail across from the provider the school is leaving. It runs in the background."
          wide
          onClose={() => setImportOpen(false)}
          footer={
            <Button type="button" variant="secondary" onClick={() => setImportOpen(false)}>
              {"Close"}
            </Button>
          }
        >
          <ImportMail mailboxId={mailbox.id} liveTick={liveTick} />
        </Modal>
      ) : null}

      {keysOpen ? (
        <Modal title="Keyboard shortcuts" onClose={() => setKeysOpen(false)}>
          <ul className="tw-m-0 tw-grid tw-list-none tw-grid-cols-2 tw-gap-x-6 tw-gap-y-2 tw-p-0 mobile:tw-grid-cols-1">
            {SHORTCUTS.map(([k, what]) => (
              <li key={k} className="tw-flex tw-items-center tw-gap-3 tw-text-[13.5px] tw-text-ink">
                <kbd className="tw-min-w-[64px] tw-rounded-md tw-border tw-border-solid tw-border-line tw-bg-bg tw-px-2 tw-py-0.5 tw-text-center tw-text-[12.5px] tw-font-semibold [font-family:inherit]">{k}</kbd>
                {what}
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}

      {settingsOpen && mailbox ? (
        <MailSettingsModal mailbox={mailbox} onClose={() => setSettingsOpen(false)} onSaved={setMailbox} />
      ) : null}

      <UndoBar
        onUndo={async (draftId) => {
          try {
            startCompose({ mode: "draft", draft: await loadMessage(draftId) });
            setNotice("Not sent. You can carry on editing it.");
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
    </div>
  );
};

export default MailPage;
