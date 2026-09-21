import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { send as sendIcon } from "react-icons-kit/feather/send";
import { check } from "react-icons-kit/feather/check";
import { paperclip } from "react-icons-kit/feather/paperclip";
import { fileText } from "react-icons-kit/feather/fileText";
import { x as xIcon } from "react-icons-kit/feather/x";
import Navbar from "../../Components/Navbar/Navbar";
import { RichTextEditor } from "../../Components/RichTextEditor";
import { sanitizeEmailHtml } from "../../lib/sanitizeEmailHtml";
import DocumentPreviewModal from "../../Components/DocumentPreview";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchChatOverview,
  openDirectMessage,
  createGroupChannel,
  fetchChatMessages,
  sendChatMessage,
  editChatMessage,
  deleteChatMessage,
  markChannelRead,
  subscribeToChatChannel,
  subscribeToMyChannels,
  subscribeToChannelMembers,
  fetchChannelMembers,
  subscribeToMessageReactions,
  addReaction,
  removeReaction,
  subscribeToTyping,
  sendTyping,
  uploadChatAttachment,
  copyChatAttachment,
  signedChatAttachmentUrl,
  fetchSchoolMembers,
} from "../../lib/api";
import { Page, Button, Notice, Empty, Modal, displayName, initials, formatDate } from "../../Components/UI";

// An empty Tiptap document still serialises to "<p></p>" — the same reason
// Tickets' own composer checks text content rather than the raw HTML.
const isHtmlEmpty = (html) => !html || !html.replace(/<[^>]+>/g, "").trim();

// Shared by the reaction picker and the per-message "⋮" menu — both are a
// small popup anchored to a trigger button that should vanish the moment
// you click (or tap) anywhere else, same as Notifications' own bell panel.
const useClickAway = (active, onAway) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onAway();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return ref;
};

// One line of quoted context above a reply, or above the composer while
// composing one — same shape either way, just a different wrapping class.
const ReplyPreview = ({ message, className }) => (
  <div className={className}>
    <strong>{message.deleted_at ? "Message deleted" : displayName(message.author)}</strong>
    {!message.deleted_at ? (
      <span>{message.body.replace(/<[^>]+>/g, "").slice(0, 80) || (message.attachment_name ? `📎 ${message.attachment_name}` : "")}</span>
    ) : null}
  </div>
);

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// A document/file bubble — download goes through a freshly-signed URL
// (chat-attachments is a private bucket) rather than a stored public link,
// fetched only at the moment someone actually clicks.
const AttachmentChip = ({ name, size, onOpen, openLabel = "Open", onRemove, busy }) => (
  <div className="chat-attachment-chip">
    <Icon icon={fileText} size={16} />
    <span className="chat-attachment-name">{name}</span>
    {size ? <span className="chat-attachment-size">{formatBytes(size)}</span> : null}
    {onOpen ? (
      <button type="button" onClick={onOpen} disabled={busy}>{busy ? "Opening…" : openLabel}</button>
    ) : null}
    {onRemove ? (
      <button type="button" aria-label="Remove attachment" onClick={onRemove}>
        <Icon icon={xIcon} size={14} />
      </button>
    ) : null}
  </div>
);

// A small, fixed set — Teams' own "quick react" bar, not a full emoji
// keyboard — keeps this to a click instead of a whole picker component.
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Never send a typing broadcast on every keystroke — once per this window
// is plenty for "someone is typing" to feel live without flooding the
// channel.
const TYPING_BROADCAST_MS = 2500;
// How long a received "typing" broadcast stays true with no follow-up —
// covers a pause mid-sentence without the indicator flickering, and self-
// clears if the other person just closes the tab mid-type.
const TYPING_EXPIRE_MS = 4000;

const ReactionBar = ({ message, myUserId, onToggle }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useClickAway(pickerOpen, () => setPickerOpen(false));
  const counts = {};
  (message.reactions || []).forEach((r) => {
    if (!counts[r.emoji]) counts[r.emoji] = { count: 0, mine: false };
    counts[r.emoji].count += 1;
    if (r.user_id === myUserId) counts[r.emoji].mine = true;
  });
  const entries = Object.entries(counts);

  return (
    <div className="chat-reactions">
      {entries.map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          type="button"
          className={`chat-reaction-chip${mine ? " mine" : ""}`}
          onClick={() => onToggle(emoji)}
        >
          {emoji} {count}
        </button>
      ))}
      <span className="chat-reaction-add-wrap" ref={wrapRef}>
        <button
          type="button"
          className="chat-reaction-add"
          aria-label="React"
          onClick={() => setPickerOpen((v) => !v)}
        >
          {"🙂+"}
        </button>
        {pickerOpen ? (
          <div className="chat-reaction-picker">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onToggle(emoji);
                  setPickerOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
      </span>
    </div>
  );
};

// The WhatsApp-style "⋮" on every message — Reply and Forward for anyone,
// Copy for anyone, Edit/Delete added only for your own and only while it's
// not already soft-deleted.
const MessageMenu = ({ message, mine, onReply, onForward, onCopy, onEdit, onDelete }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useClickAway(open, () => setOpen(false));
  const act = (fn) => {
    setOpen(false);
    fn();
  };

  return (
    <span className="chat-menu-wrap" ref={wrapRef}>
      <button type="button" className="chat-menu-btn" aria-label="More actions" onClick={() => setOpen((v) => !v)}>
        {"⋮"}
      </button>
      {open ? (
        <div className="chat-menu-panel" role="menu">
          <button type="button" role="menuitem" onClick={() => act(onReply)}>{"Reply"}</button>
          <button type="button" role="menuitem" onClick={() => act(onForward)}>{"Forward"}</button>
          {!message.deleted_at ? (
            <button type="button" role="menuitem" onClick={() => act(onCopy)}>{"Copy text"}</button>
          ) : null}
          {mine && !message.deleted_at ? (
            <>
              <button type="button" role="menuitem" onClick={() => act(onEdit)}>{"Edit"}</button>
              <button type="button" role="menuitem" className="danger" onClick={() => act(onDelete)}>{"Delete"}</button>
            </>
          ) : null}
        </div>
      ) : null}
    </span>
  );
};

// WhatsApp-style channel picker for "Forward" — the same schoolMembers-free
// list of chats the sidebar already renders, since forwarding only ever
// needs somewhere the sender is already a member of.
const ForwardModal = ({ message, channels, onClose, onForward }) => {
  const [busyId, setBusyId] = useState(null);
  const forward = async (channelId) => {
    setBusyId(channelId);
    try {
      await onForward(channelId);
      onClose();
    } finally {
      setBusyId(null);
    }
  };
  return (
    <Modal title="Forward message" onClose={onClose}>
      <ReplyPreview message={message} className="chat-forward-preview" />
      {channels.length === 0 ? (
        <p className="chat-picker-empty">{"No other chats to forward to yet."}</p>
      ) : (
        <ul className="chat-picker-list" style={{ marginTop: 12 }}>
          {channels.map((c) => (
            <li key={c.id}>
              <button type="button" className="chat-picker-row" disabled={busyId === c.id} onClick={() => forward(c.id)}>
                <span className="tix-avatar sm">{initials({ first_name: c.name })}</span>
                <span className="chat-picker-row-label">{c.name || "Unnamed channel"}</span>
                {busyId === c.id ? <span>{"Sending…"}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

// The Teams-style "who is this" card behind clicking anyone's avatar —
// role and reporting line come straight out of the same schoolMembers list
// the page already loaded to resolve message authors, no extra fetch.
const PersonModal = ({ person, schoolMembers, onClose }) => {
  const manager = person.manager_id ? schoolMembers.find((m) => m.user_id === person.manager_id) : null;
  const reports = schoolMembers.filter((m) => m.manager_id === person.user_id);

  return (
    <Modal title="Profile" onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <span className="tix-avatar" style={{ width: 52, height: 52, fontSize: 18 }}>
          {initials(person.profiles)}
        </span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{displayName(person.profiles)}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", textTransform: "capitalize" }}>{person.role}</div>
        </div>
      </div>

      {person.profiles?.email ? (
        <div className="person-field">
          <label>{"Email"}</label>
          <div className="person-field-value">{person.profiles.email}</div>
        </div>
      ) : null}

      <div className="person-field">
        <label>{"Reports to"}</label>
        {manager ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tix-avatar sm">{initials(manager.profiles)}</span>
            <span className="person-field-value">
              {displayName(manager.profiles)} · <span style={{ textTransform: "capitalize" }}>{manager.role}</span>
            </span>
          </div>
        ) : (
          <div className="person-field-value">{"Not set"}</div>
        )}
      </div>

      {reports.length > 0 ? (
        <div className="person-field">
          <label>{`Direct reports (${reports.length})`}</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reports.map((r) => (
              <div key={r.user_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tix-avatar sm">{initials(r.profiles)}</span>
                <span className="person-field-value">
                  {displayName(r.profiles)} · <span style={{ textTransform: "capitalize" }}>{r.role}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  );
};

// Today shows just the time (Teams' own convention for a chat list); older
// falls back to a short date so a week-old thread isn't mistaken for "now".
const shortTimestamp = (value) => {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const NewChatModal = ({ schoolId, myUserId, onClose, onCreated, onError }) => {
  const [members, setMembers] = useState([]);
  const [mode, setMode] = useState("dm");
  const [otherUserId, setOtherUserId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchSchoolMembers(schoolId)
      .then((rows) => setMembers(rows.filter((r) => r.user_id !== myUserId)))
      .catch(() => setMembers([]));
  }, [schoolId, myUserId]);

  // A school with a real staff list quickly outgrows "scroll and squint" —
  // matches name or role, same fields the row itself shows.
  const visibleMembers = members.filter((m) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${displayName(m.profiles)} ${m.role}`.toLowerCase().includes(needle);
  });

  const toggleGroupMember = (userId) =>
    setGroupMemberIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const channel =
        mode === "dm"
          ? await openDirectMessage({ schoolId, otherUserId })
          : await createGroupChannel({ schoolId, name: groupName.trim(), memberIds: groupMemberIds });
      onCreated(channel.id);
    } catch (err) {
      onError(err.message || "Could not start that chat.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New chat" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="btn-row" style={{ marginBottom: 14 }}>
          <Button type="button" variant={mode === "dm" ? "primary" : "secondary"} onClick={() => setMode("dm")}>
            {"Direct message"}
          </Button>
          <Button type="button" variant={mode === "group" ? "primary" : "secondary"} onClick={() => setMode("group")}>
            {"Group"}
          </Button>
        </div>

        {members.length > 6 ? (
          <input
            className="input"
            placeholder="Search by name or role..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: 10 }}
          />
        ) : null}

        {mode === "dm" ? (
          members.length === 0 ? (
            <p className="chat-picker-empty">{"No one else here yet."}</p>
          ) : visibleMembers.length === 0 ? (
            <p className="chat-picker-empty">{"No one matches that search."}</p>
          ) : (
            <ul className="chat-picker-list">
              {visibleMembers.map((m) => (
                <li key={m.user_id}>
                  <button
                    type="button"
                    className={`chat-picker-row${otherUserId === m.user_id ? " selected" : ""}`}
                    onClick={() => setOtherUserId(m.user_id)}
                  >
                    <span className="tix-avatar sm">{initials(m.profiles)}</span>
                    <span className="chat-picker-row-label">
                      {displayName(m.profiles)} · {m.role}
                    </span>
                    {otherUserId === m.user_id ? <Icon icon={check} size={16} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <input
              className="input"
              placeholder="Channel name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            {members.length === 0 ? (
              <p className="chat-picker-empty">{"No one else here yet."}</p>
            ) : visibleMembers.length === 0 ? (
              <p className="chat-picker-empty">{"No one matches that search."}</p>
            ) : (
              <ul className="chat-picker-list">
                {visibleMembers.map((m) => {
                  const checked = groupMemberIds.includes(m.user_id);
                  return (
                    <li key={m.user_id}>
                      <button
                        type="button"
                        className={`chat-picker-row${checked ? " selected" : ""}`}
                        onClick={() => toggleGroupMember(m.user_id)}
                      >
                        <span className="tix-avatar sm">{initials(m.profiles)}</span>
                        <span className="chat-picker-row-label">
                          {displayName(m.profiles)} · {m.role}
                        </span>
                        {checked ? <Icon icon={check} size={16} /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        <div style={{ marginTop: 16 }}>
          <Button
            type="submit"
            disabled={busy || (mode === "dm" ? !otherUserId : !groupName.trim() || groupMemberIds.length === 0)}
          >
            {busy ? "Starting..." : mode === "dm" ? "Start chat" : "Create group"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ChatPage = () => {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { schoolId } = useSchool();

  const [channels, setChannels] = useState([]);
  const [schoolMembers, setSchoolMembers] = useState([]);
  const [membersById, setMembersById] = useState({});
  const membersByIdRef = useRef({});
  membersByIdRef.current = membersById;
  const [messages, setMessages] = useState([]);
  const messagesRef = useRef([]);
  messagesRef.current = messages;
  const [composeBody, setComposeBody] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [viewingPerson, setViewingPerson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [channelMembers, setChannelMembers] = useState([]);
  const [typingUserIds, setTypingUserIds] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [openingAttachmentId, setOpeningAttachmentId] = useState(null);
  const threadEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingChannelRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const typingTimeoutsRef = useRef({});

  const openPerson = (userId) => {
    const person = schoolMembers.find((m) => m.user_id === userId);
    if (person) setViewingPerson(person);
  };

  const loadOverview = useCallback(() => {
    if (!schoolId) return;
    fetchChatOverview(schoolId)
      .then(setChannels)
      .catch((err) => setError(err.message || "Could not load your chats."));
  }, [schoolId]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  // Realtime INSERT payloads are the raw table row — no joined author
  // profile — so a message arriving from someone else while the thread is
  // open would show "Someone" until the next full reload. Cache the
  // school's members once (role + manager_id too — the same list backs the
  // avatar-click profile card) and resolve names/roles from it instead.
  useEffect(() => {
    if (!schoolId) return;
    fetchSchoolMembers(schoolId)
      .then((rows) => {
        setSchoolMembers(rows);
        const byId = {};
        rows.forEach((r) => { byId[r.user_id] = r.profiles; });
        setMembersById(byId);
      })
      .catch(() => {});
  }, [schoolId]);

  // Any change to any channel I'm in (a new message elsewhere, someone
  // adding me to a group) refreshes the sidebar so unread badges and
  // ordering stay current without a manual reload.
  useEffect(() => {
    if (!user?.id) return undefined;
    const channel = subscribeToMyChannels(user.id, () => loadOverview());
    return () => channel.unsubscribe();
  }, [user?.id, loadOverview]);

  const loadChannelMembers = useCallback(() => {
    if (!channelId) return;
    fetchChannelMembers(channelId).then(setChannelMembers).catch(() => {});
  }, [channelId]);

  useEffect(() => {
    if (!channelId) { setMessages([]); setChannelMembers([]); return; }
    setLoading(true);
    fetchChatMessages(channelId)
      .then(setMessages)
      .catch((err) => setError(err.message || "Could not load this chat."))
      .finally(() => setLoading(false));
    if (user?.id) markChannelRead({ channelId, userId: user.id }).catch(() => {});
    loadChannelMembers();
    setTypingUserIds([]);
    setReplyingTo(null);
    clearPendingFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, user?.id, loadChannelMembers]);

  useEffect(() => {
    if (!channelId) return undefined;
    const channel = subscribeToChatChannel(channelId, (payload) => {
      if (payload.eventType === "INSERT") {
        const repliedTo = payload.new.reply_to_id
          ? messagesRef.current.find((m) => m.id === payload.new.reply_to_id)
          : null;
        const withAuthor = {
          ...payload.new,
          reactions: [],
          author: membersByIdRef.current[payload.new.author_id],
          reply_to: repliedTo || null,
        };
        setMessages((current) =>
          current.some((m) => m.id === withAuthor.id) ? current : [...current, withAuthor]
        );
        if (user?.id && payload.new.author_id !== user.id) {
          markChannelRead({ channelId, userId: user.id }).catch(() => {});
        }
      } else if (payload.eventType === "UPDATE") {
        setMessages((current) => current.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m)));
      }
      loadOverview();
    });
    return () => channel.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, user?.id]);

  // "Seen" — every OTHER member's own last_read_at, live. The sidebar's own
  // subscribeToMyChannels only ever tells me about MY memberships; this is
  // the one open thread's full roster.
  useEffect(() => {
    if (!channelId) return undefined;
    const channel = subscribeToChannelMembers(channelId, () => loadChannelMembers());
    return () => channel.unsubscribe();
  }, [channelId, loadChannelMembers]);

  // Reactions have no channel_id to filter on server-side (see api.js), so
  // every change reaches every open ChatPage and this drops whatever isn't
  // for a message actually on screen.
  useEffect(() => {
    const channel = subscribeToMessageReactions((payload) => {
      const row = payload.new || payload.old;
      if (!row || !messagesRef.current.some((m) => m.id === row.message_id)) return;
      setMessages((current) =>
        current.map((m) => {
          if (m.id !== row.message_id) return m;
          const without = (m.reactions || []).filter(
            (r) => !(r.user_id === row.user_id && r.emoji === row.emoji)
          );
          return { ...m, reactions: payload.eventType === "DELETE" ? without : [...without, row] };
        })
      );
    });
    return () => channel.unsubscribe();
  }, []);

  // Typing — a pure ephemeral broadcast (see sendTyping/subscribeToTyping in
  // api.js), never written to the database. Each incoming ping refreshes a
  // per-user timeout; if none follow within TYPING_EXPIRE_MS the indicator
  // clears itself, so a closed tab or a lost connection doesn't leave
  // "typing..." stuck forever.
  useEffect(() => {
    Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
    typingTimeoutsRef.current = {};
    setTypingUserIds([]);
    if (!channelId) { typingChannelRef.current = null; return undefined; }
    const channel = subscribeToTyping(channelId, ({ userId }) => {
      if (!userId || userId === user?.id) return;
      setTypingUserIds((current) => (current.includes(userId) ? current : [...current, userId]));
      clearTimeout(typingTimeoutsRef.current[userId]);
      typingTimeoutsRef.current[userId] = setTimeout(() => {
        setTypingUserIds((current) => current.filter((id) => id !== userId));
      }, TYPING_EXPIRE_MS);
    });
    typingChannelRef.current = channel;
    return () => {
      channel.unsubscribe();
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
    };
  }, [channelId, user?.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const notifyTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_BROADCAST_MS) return;
    lastTypingSentRef.current = now;
    sendTyping(typingChannelRef.current, user?.id);
  };

  const toggleReaction = async (message, emoji) => {
    const mine = (message.reactions || []).some((r) => r.user_id === user.id && r.emoji === emoji);
    // Optimistic — the realtime round trip would otherwise make every
    // reaction feel like it lags by a network hop.
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== message.id) return m;
        const reactions = mine
          ? (m.reactions || []).filter((r) => !(r.user_id === user.id && r.emoji === emoji))
          : [...(m.reactions || []), { user_id: user.id, emoji }];
        return { ...m, reactions };
      })
    );
    try {
      if (mine) await removeReaction({ messageId: message.id, userId: user.id, emoji });
      else await addReaction({ messageId: message.id, userId: user.id, emoji });
    } catch (err) {
      setError(err.message || "Could not update that reaction.");
    }
  };

  const send = async (e) => {
    e?.preventDefault();
    if ((isHtmlEmpty(composeBody) && !pendingFile) || sending) return;
    setSending(true);
    setError("");
    try {
      // The file only actually uploads now, at send time — picking a file
      // just previews it locally (see handleFileChange), so cancelling
      // never leaves an orphaned object in storage for a message that was
      // never sent.
      const attachment = pendingFile ? await uploadChatAttachment({ channelId, file: pendingFile.file }) : null;
      const message = await sendChatMessage({
        channelId,
        authorId: user.id,
        body: isHtmlEmpty(composeBody) ? "" : composeBody,
        replyToId: replyingTo?.id,
        attachment,
      });
      // The RPC round trip has no reason to know what "replying to" means —
      // ChatPage is already holding the exact message object, so attach it
      // straight from state instead of asking the server to resolve its own
      // self-join (see CHAT_MESSAGE_SELECT's comment in api.js).
      setMessages((current) => [...current, { ...message, reply_to: replyingTo || null }]);
      setComposeBody("");
      setReplyingTo(null);
      clearPendingFile();
      loadOverview();
    } catch (err) {
      setError(err.message || "Could not send that message.");
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async (messageId) => {
    if (isHtmlEmpty(editBody)) return;
    try {
      const updated = await editChatMessage({ messageId, body: editBody });
      setMessages((current) => current.map((m) => (m.id === messageId ? { ...m, ...updated } : m)));
      setEditingId(null);
    } catch (err) {
      setError(err.message || "Could not save that edit.");
    }
  };

  const remove = async (messageId) => {
    try {
      await deleteChatMessage(messageId);
      setMessages((current) =>
        current.map((m) => (m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m))
      );
    } catch (err) {
      setError(err.message || "Could not delete that message.");
    }
  };

  // Picking a file only previews it — see send()'s own comment for why the
  // actual upload waits until Send is pressed.
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (pendingFile) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile({ file, name: file.name, size: file.size, previewUrl: URL.createObjectURL(file) });
  };

  const clearPendingFile = () => {
    setPendingFile((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  };

  const copyMessageText = (message) => {
    const text = message.body.replace(/<[^>]+>/g, "").trim() || message.attachment_name || "";
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  // Same in-page viewer used across the app for course materials/admission
  // documents (DocumentPreview.jsx) — a chat file is just another private,
  // signed-URL-on-demand document, so no reason for it to behave
  // differently (jump to a new tab) from every other document in the app.
  const previewPendingFile = () =>
    setPreviewDoc({ url: pendingFile.previewUrl, path: pendingFile.name, name: pendingFile.name });

  const openAttachment = async (message) => {
    setOpeningAttachmentId(message.id);
    try {
      const url = await signedChatAttachmentUrl(message.attachment_path);
      setPreviewDoc({ url, path: message.attachment_path, name: message.attachment_name });
    } catch (err) {
      setError(err.message || "Could not open that file.");
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  // Forwarding copies the attachment into the destination channel's own
  // storage prefix first (see copyChatAttachment in api.js) — the file's
  // read policy is keyed to whichever channel's folder it actually lives
  // in, not to whatever the message row says.
  const forwardTo = async (targetChannelId) => {
    if (!forwardMessage) return;
    let attachment = null;
    if (forwardMessage.attachment_path) {
      const path = await copyChatAttachment({
        fromPath: forwardMessage.attachment_path,
        toChannelId: targetChannelId,
        fileName: forwardMessage.attachment_name,
      });
      attachment = {
        path,
        name: forwardMessage.attachment_name,
        size: forwardMessage.attachment_size,
        mime: forwardMessage.attachment_mime,
      };
    }
    const message = await sendChatMessage({
      channelId: targetChannelId,
      authorId: user.id,
      body: forwardMessage.body || "",
      attachment,
    });
    if (targetChannelId === channelId) setMessages((current) => [...current, message]);
    loadOverview();
  };

  const activeChannel = channels.find((c) => c.id === channelId);
  const myProfile = membersById[user?.id];
  // The other side of a DM — chat_overview never names them (it returns
  // the channel's display name, not a user id), but the roster fetched for
  // "seen" already has every member of THIS open channel.
  const otherMemberId = channelMembers.find((m) => m.user_id !== user?.id)?.user_id;
  const otherReadAt = channelMembers
    .filter((m) => m.user_id !== user?.id)
    .map((m) => m.last_read_at)
    .sort()
    .pop();
  const lastMineIndex = [...messages].map((m, i) => ({ m, i })).filter(({ m }) => m.author_id === user?.id).pop()?.i;
  const typingNames = typingUserIds.map((id) => displayName(membersById[id])).filter(Boolean);

  return (
    <div className="shell">
      <Navbar />
      <Page title="Chat" wide>
        <Notice tone="error">{error}</Notice>
        <div className="tix-shell tix-detail chat-detail">
          <aside className="tix-detail-list">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <strong>{"Chats"}</strong>
              <Button size="sm" onClick={() => setShowNewChat(true)}>{"New"}</Button>
            </div>
            {channels.length === 0 ? (
              <Empty>{"No chats yet. Start one with “New” above."}</Empty>
            ) : (
              channels.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  className={`chat-list-item${c.id === channelId ? " active" : ""}`}
                  onClick={() => navigate(`/Chat/${c.id}`)}
                  onKeyDown={(e) => { if (e.key === "Enter") navigate(`/Chat/${c.id}`); }}
                >
                  <button
                    type="button"
                    className="tix-avatar chat-avatar-btn"
                    disabled={!c.other_user_id}
                    onClick={(e) => { e.stopPropagation(); if (c.other_user_id) openPerson(c.other_user_id); }}
                  >
                    {initials({ first_name: c.name })}
                  </button>
                  <span className="chat-list-item-main">
                    <span className="chat-list-item-top">
                      <span
                        className={`chat-list-item-name${c.unread_count > 0 ? " unread" : ""}${c.other_user_id ? " chat-clickable-name" : ""}`}
                        onClick={c.other_user_id ? (e) => { e.stopPropagation(); openPerson(c.other_user_id); } : undefined}
                      >
                        {c.name || "Unnamed channel"}
                      </span>
                      <span className="chat-list-item-time">{shortTimestamp(c.last_message_at)}</span>
                    </span>
                    <span className="chat-list-item-preview">
                      <span>{(c.last_message_preview || "No messages yet").replace(/<[^>]+>/g, "")}</span>
                      {c.unread_count > 0 ? <span className="bell-count">{c.unread_count}</span> : null}
                    </span>
                  </span>
                </div>
              ))
            )}
          </aside>

          <section className="tix-thread chat-thread">
            {!channelId ? (
              <div className="chat-thread-empty"><Empty>{"Pick a chat on the left, or start a new one."}</Empty></div>
            ) : loading ? (
              <div className="chat-thread-empty"><Empty>{"Loading..."}</Empty></div>
            ) : (
              <>
                <div className="chat-thread-head">
                  <button
                    type="button"
                    className="tix-avatar sm chat-avatar-btn"
                    disabled={!otherMemberId}
                    onClick={() => otherMemberId && openPerson(otherMemberId)}
                  >
                    {initials({ first_name: activeChannel?.name })}
                  </button>
                  <div>
                    <h1
                      className={otherMemberId ? "chat-clickable-name" : undefined}
                      onClick={() => otherMemberId && openPerson(otherMemberId)}
                    >
                      {activeChannel?.name || "Chat"}
                    </h1>
                    {typingNames.length > 0 ? (
                      <div className="chat-typing">{`${typingNames.join(", ")} ${typingNames.length > 1 ? "are" : "is"} typing…`}</div>
                    ) : null}
                  </div>
                </div>

                <div className="chat-thread-body">
                  {messages.map((m, i) => {
                    const mine = m.author_id === user?.id;
                    const prev = messages[i - 1];
                    // Consecutive messages from the same person, sent close
                    // together, read as one continued turn — Teams drops
                    // the repeated avatar/name for those, same as here.
                    const grouped =
                      prev &&
                      prev.author_id === m.author_id &&
                      new Date(m.created_at) - new Date(prev.created_at) < 5 * 60 * 1000;
                    const seen = i === lastMineIndex && mine && otherReadAt && otherReadAt >= m.created_at;
                    return (
                      <div key={m.id} className={`chat-msg-row${mine ? " mine" : ""}${grouped ? " grouped" : ""}`}>
                        <button
                          type="button"
                          className={`tix-avatar sm chat-avatar-btn${grouped ? " spacer" : ""}`}
                          onClick={() => openPerson(mine ? user.id : m.author_id)}
                        >
                          {mine ? initials(myProfile) : initials(m.author)}
                        </button>
                        <div className="chat-msg-col">
                          <div className="chat-msg-meta">
                            {!grouped ? (
                              <strong
                                className="chat-clickable-name"
                                onClick={() => openPerson(mine ? user.id : m.author_id)}
                              >
                                {mine ? "You" : displayName(m.author)}
                              </strong>
                            ) : null}
                            {!grouped ? <span>{formatDate(m.created_at)}{m.edited_at ? " · edited" : ""}</span> : null}
                            {!m.deleted_at ? (
                              <MessageMenu
                                message={m}
                                mine={mine}
                                onReply={() => setReplyingTo(m)}
                                onForward={() => setForwardMessage(m)}
                                onCopy={() => copyMessageText(m)}
                                onEdit={() => { setEditingId(m.id); setEditBody(m.body); }}
                                onDelete={() => remove(m.id)}
                              />
                            ) : null}
                          </div>
                          {m.deleted_at ? (
                            <div className="chat-bubble deleted">{"Message deleted."}</div>
                          ) : editingId === m.id ? (
                            <div>
                              <RichTextEditor
                                value={editBody}
                                onChange={setEditBody}
                                placeholder="Edit message..."
                                onSubmitEditor={() => saveEdit(m.id)}
                              />
                              <div className="btn-row" style={{ marginTop: 6 }}>
                                <Button size="sm" onClick={() => saveEdit(m.id)}>{"Save"}</Button>
                                <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>{"Cancel"}</Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {m.reply_to ? <ReplyPreview message={m.reply_to} className="chat-reply-quote" /> : null}
                              {!isHtmlEmpty(m.body) ? (
                                <div
                                  className="chat-bubble tix-msg-html"
                                  dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(m.body) }}
                                />
                              ) : null}
                              {m.attachment_path ? (
                                <AttachmentChip
                                  name={m.attachment_name}
                                  size={m.attachment_size}
                                  busy={openingAttachmentId === m.id}
                                  onOpen={() => openAttachment(m)}
                                />
                              ) : null}
                              <ReactionBar message={m} myUserId={user?.id} onToggle={(emoji) => toggleReaction(m, emoji)} />
                            </>
                          )}
                          {seen ? <div className="chat-seen">{"Seen"}</div> : null}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={threadEndRef} />
                </div>

                <form onSubmit={send} className="chat-composer">
                  {replyingTo ? (
                    <div className="chat-replying-bar">
                      <ReplyPreview message={replyingTo} className="chat-reply-quote" />
                      <button type="button" aria-label="Cancel reply" onClick={() => setReplyingTo(null)}>
                        <Icon icon={xIcon} size={14} />
                      </button>
                    </div>
                  ) : null}
                  {pendingFile ? (
                    <AttachmentChip
                      name={pendingFile.name}
                      size={pendingFile.size}
                      onOpen={previewPendingFile}
                      openLabel="Preview"
                      onRemove={clearPendingFile}
                    />
                  ) : null}
                  <RichTextEditor
                    value={composeBody}
                    onChange={(html) => { setComposeBody(html); notifyTyping(); }}
                    placeholder="Type a message..."
                    onSubmitEditor={send}
                  />
                  <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
                  <div className="chat-composer-row">
                    <button
                      type="button"
                      className="chat-composer-attach"
                      aria-label="Attach a file"
                      disabled={!!pendingFile}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Icon icon={paperclip} size={17} />
                    </button>
                    <span style={{ flex: 1 }} />
                    <button
                      type="submit"
                      className="chat-composer-send"
                      disabled={sending || (isHtmlEmpty(composeBody) && !pendingFile)}
                      aria-label="Send"
                    >
                      <Icon icon={sendIcon} size={17} />
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      </Page>

      {showNewChat ? (
        <NewChatModal
          schoolId={schoolId}
          myUserId={user?.id}
          onClose={() => setShowNewChat(false)}
          onCreated={(id) => { setShowNewChat(false); loadOverview(); navigate(`/Chat/${id}`); }}
          onError={setError}
        />
      ) : null}

      {viewingPerson ? (
        <PersonModal person={viewingPerson} schoolMembers={schoolMembers} onClose={() => setViewingPerson(null)} />
      ) : null}

      {forwardMessage ? (
        <ForwardModal
          message={forwardMessage}
          channels={channels.filter((c) => c.id !== channelId)}
          onClose={() => setForwardMessage(null)}
          onForward={forwardTo}
        />
      ) : null}

      {previewDoc ? (
        <DocumentPreviewModal
          url={previewDoc.url}
          path={previewDoc.path}
          name={previewDoc.name}
          onClose={() => setPreviewDoc(null)}
        />
      ) : null}
    </div>
  );
};

export default ChatPage;
