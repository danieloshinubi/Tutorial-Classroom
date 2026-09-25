import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { send as sendIcon } from "react-icons-kit/feather/send";
import { check } from "react-icons-kit/feather/check";
import { paperclip } from "react-icons-kit/feather/paperclip";
import { fileText } from "react-icons-kit/feather/fileText";
import { x as xIcon } from "react-icons-kit/feather/x";
import { type as formatIcon } from "react-icons-kit/feather/type";
import { arrowLeft } from "react-icons-kit/feather/arrowLeft";
import { cornerUpLeft } from "react-icons-kit/feather/cornerUpLeft";
import Navbar from "../../Components/Navbar/Navbar";
import { RichTextEditor } from "../../Components/RichTextEditor";
import { sanitizeEmailHtml } from "../../lib/sanitizeEmailHtml";
import DocumentPreviewModal, { isImagePath } from "../../Components/DocumentPreview";
import PersonModal from "../../Components/PersonModal";
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
  subscribeToSchoolChatActivity,
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
  addChatMembers,
  removeChatMember,
  setChatMemberRole,
  renameChatChannel,
} from "../../lib/api";
import { Page, Button, Notice, Empty, Modal, displayName, initials } from "../../Components/UI";

// An empty Tiptap document still serialises to "<p></p>" — the same reason
// Tickets' own composer checks text content rather than the raw HTML.
const isHtmlEmpty = (html) => !html || !html.replace(/<[^>]+>/g, "").trim();

// Utility strings that recur across the list pane, the thread head and every
// message row. Named here rather than repeated inline so the three places
// that render an avatar button (or a typing line) cannot drift apart — which
// is what the shared .chat-* classes these replace were doing for them.
//
// Paired with .tix-avatar at each call site: that one stays a real CSS class,
// since it is used all over the app, well outside the Chat files Tailwind
// scans.
const AVATAR_BTN =
  "tw-border-none tw-p-0 tw-cursor-pointer [font-family:inherit] disabled:tw-cursor-default " +
  "enabled:hover:tw-brightness-110 focus-visible:tw-outline focus-visible:tw-outline-2 " +
  "focus-visible:tw-outline-offset-2 focus-visible:tw-outline-tix-brand";

// The name beside a clickable avatar opens the same profile card — one
// combined target rather than forcing the click onto the small circle.
const CLICKABLE_NAME = "tw-cursor-pointer hover:tw-underline";

const TYPING = "tw-text-xs tw-text-tix-ink-3 tw-italic tw-mt-0.5";

// A quoted reply. The child [&_strong]/[&_span] rules are arbitrary variants
// rather than classes on ReplyPreview's own tags, because ReplyPreview is
// also rendered WITHOUT this quote styling (the Forward modal shows the same
// markup as a plain line), and the original CSS scoped those child rules to
// this wrapper for exactly that reason.
const REPLY_QUOTE =
  "tw-border-0 tw-border-solid tw-border-l-[3px] tw-border-l-tix-brand tw-py-1 tw-px-2.5 tw-mb-1.5 " +
  "tw-rounded-[4px] tw-bg-tix-surface-2 tw-text-[12.5px] " +
  "[&_strong]:tw-block [&_strong]:tw-text-tix-brand [&_strong]:tw-text-xs [&_span]:tw-text-tix-ink-3";

// GLOBAL tokens (--ink/--line/--surface/--bg/--danger), never --tix-*, for
// everything below: the two popovers are portalled to <body> and the pickers
// render inside a Modal, and both sit OUTSIDE .tix-shell — which is the only
// place --tix-* is ever declared. Each of these is the global token that
// .tix-shell aliases anyway, so the result is identical where it already
// worked, and correct where it silently did not.
const MENU_PANEL =
  "tw-fixed tw-z-[60] tw-min-w-[140px] tw-flex tw-flex-col tw-p-1 tw-border tw-border-solid " +
  "tw-border-line tw-rounded-[10px] tw-bg-surface tw-shadow-2";
const MENU_ITEM =
  "tw-border-none tw-bg-transparent tw-text-ink-2 tw-text-[13px] tw-text-left tw-py-[7px] tw-px-2.5 " +
  "tw-rounded-md tw-cursor-pointer [font-family:inherit] hover:tw-bg-bg hover:tw-text-ink";
const MENU_ITEM_DANGER =
  "tw-border-none tw-bg-transparent tw-text-danger hover:tw-text-danger tw-text-[13px] tw-text-left " +
  "tw-py-[7px] tw-px-2.5 tw-rounded-md tw-cursor-pointer [font-family:inherit] " +
  "hover:tw-bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]";
const REACTION_PICKER =
  "tw-fixed tw-z-[60] tw-flex tw-gap-1 tw-p-1.5 tw-border tw-border-solid tw-border-line " +
  "tw-rounded-[10px] tw-bg-surface tw-shadow-2";
const REACTION_PICKER_BTN =
  "tw-border-none tw-bg-transparent tw-text-[18px] tw-py-0.5 tw-px-1 tw-cursor-pointer tw-rounded-md hover:tw-bg-bg";

const PICKER_LIST =
  "tw-list-none tw-m-0 tw-p-0 tw-max-h-[260px] tw-overflow-y-auto tw-border tw-border-solid " +
  "tw-border-line tw-rounded-[10px]";
const PICKER_ROW =
  "tw-flex tw-items-center tw-gap-2.5 tw-w-full tw-text-left tw-cursor-pointer tw-border-none " +
  "tw-bg-transparent tw-py-2.5 tw-px-3 [font-family:inherit] hover:tw-bg-bg";
const PICKER_ROW_SELECTED = "tw-bg-[color-mix(in_srgb,var(--brand)_10%,transparent)]";
const PICKER_ROW_LABEL = "tw-flex-1 tw-min-w-0 tw-text-[13.5px] tw-text-ink-2";
const PICKER_EMPTY = "tw-py-3.5 tw-px-3 tw-text-[13px] tw-text-ink-3";

// The round icon buttons in the composer pill (formatting, emoji, attach).
const ICON_BTN =
  "tw-flex-none tw-w-8 tw-h-8 tw-rounded-full tw-border-none tw-cursor-pointer tw-flex tw-items-center " +
  "tw-justify-center tw-bg-transparent tw-text-tix-ink-3 tw-text-base tw-leading-none " +
  "enabled:hover:tw-bg-tix-surface enabled:hover:tw-text-tix-ink " +
  "disabled:tw-opacity-50 disabled:tw-cursor-not-allowed";

// Shared by the reaction picker and the per-message "⋮" menu — both are a
// small popup anchored to a trigger button that should vanish the moment
// you click (or tap) anywhere else, same as Notifications' own bell panel.
//
// extraRefs exists because the chat popups are portalled out of the thread
// (see useAnchoredPopover): a portalled panel is not a DOM descendant of
// the wrapper, so without naming it here every click INSIDE the menu would
// count as a click away and close it before the item could fire.
const useClickAway = (active, onAway, extraRefs = []) => {
  const ref = useRef(null);
  const extraRef = useRef(extraRefs);
  extraRef.current = extraRefs;
  useEffect(() => {
    if (!active) return undefined;
    const onPointerDown = (event) => {
      const inside = [ref, ...extraRef.current].some(
        (r) => r.current && r.current.contains(event.target)
      );
      if (!inside) onAway();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return ref;
};

// Places a portalled popup against its trigger in fixed coordinates.
//
// These popups live inside .chat-thread-body, which is a scroll box
// (overflow-y: auto) — and a scroll box CLIPS absolutely-positioned
// descendants that extend past it. A six-item "⋮" menu opened on a message
// near the top of the thread had its first four items sliced off at the
// scroll box's edge, leaving what looked like a stray "Edit / Delete" card.
// Nothing positional fixes that from inside: transforms, negative offsets
// and z-index are all still subject to the ancestor's clip. So the panel is
// portalled to <body> and positioned here instead.
//
// Preference is above the trigger (a thumb on a phone covers what's below
// it), flipping under when there isn't room above, and clamped to the
// viewport either way so it can never open off-screen. It re-measures on
// scroll and resize so it tracks the message it belongs to.
const useAnchoredPopover = (active, anchorRef, panelRef, gap = 6, margin = 8) => {
  const [style, setStyle] = useState({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!active) return undefined;
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();

      let top = a.top - p.height - gap;
      if (top < margin) top = a.bottom + gap;
      if (top + p.height > window.innerHeight - margin) {
        top = window.innerHeight - margin - p.height;
      }
      if (top < margin) top = margin;

      // Right edges aligned with the trigger, which is what the old
      // right: 0 anchor did, then pulled back inside the viewport.
      let left = a.right - p.width;
      if (left + p.width > window.innerWidth - margin) left = window.innerWidth - margin - p.width;
      if (left < margin) left = margin;

      setStyle({ top, left, visibility: "visible" });
    };

    place();
    window.addEventListener("resize", place);
    // Capture phase: the thread body scrolls, not the window, and a
    // scroll event on an inner element does not bubble to window.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [active, anchorRef, panelRef, gap, margin]);

  useEffect(() => {
    if (!active) setStyle({ visibility: "hidden" });
  }, [active]);

  return style;
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

// One circle — a photo when there is one, initials otherwise. Sizes are
// computed (the cluster below scales its pieces), so geometry goes in a style
// prop; a Tailwind class cannot be generated from a runtime number.
const Avatar = ({ profile, size }) =>
  profile?.avatar_url ? (
    <img
      src={profile.avatar_url}
      alt=""
      className="tix-avatar tw-object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="tix-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(profile)}
    </span>
  );

// A group's avatar, the way Teams does it: the first few members' own avatars
// clustered into one circle, rather than initials taken from the group's name
// ("Testing one or two" -> "TO", which tells you nothing about who is in it).
// The viewer is excluded upstream, so these are the other people.
const GroupAvatar = ({ profiles, size = 34 }) => {
  const shown = profiles.slice(0, 3);
  if (shown.length === 0) return <span className="tix-avatar" style={{ width: size, height: size }} />;
  if (shown.length === 1) return <Avatar profile={shown[0]} size={size} />;

  // Two sit on a diagonal; three make a triangle. Each piece is scaled so the
  // cluster still reads as one avatar at the size a list row gives it.
  const piece = shown.length === 2 ? Math.round(size * 0.68) : Math.round(size * 0.6);
  const spots =
    shown.length === 2
      ? [{ top: 0, left: 0 }, { bottom: 0, right: 0 }]
      : [{ top: 0, left: Math.round((size - piece) / 2) }, { bottom: 0, left: 0 }, { bottom: 0, right: 0 }];

  return (
    <span className="tw-relative tw-inline-block tw-flex-none" style={{ width: size, height: size }}>
      {shown.map((p, i) => (
        <span key={p?.id || i} className="tw-absolute tw-leading-none" style={spots[i]}>
          <Avatar profile={p} size={piece} />
        </span>
      ))}
    </span>
  );
};

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// A document/file bubble — download goes through a freshly-signed URL
// (chat-attachments is a private bucket) rather than a stored public link,
// fetched only at the moment someone actually clicks.
const ATTACHMENT_ACTION =
  "tw-flex-none tw-border-none tw-bg-transparent tw-text-tix-brand tw-text-xs tw-font-semibold " +
  "tw-cursor-pointer tw-py-0.5 tw-px-1 tw-inline-flex tw-items-center hover:tw-underline";

const AttachmentChip = ({ name, size, onOpen, openLabel = "Open", onRemove, busy }) => (
  <div className="tw-inline-flex tw-items-center tw-gap-2 tw-mt-1.5 tw-py-[7px] tw-px-2.5 tw-border tw-border-solid tw-border-tix-line tw-rounded-[10px] tw-bg-tix-surface tw-max-w-[260px]">
    <Icon icon={fileText} size={16} />
    <span className="tw-text-[12.5px] tw-text-tix-ink-2 tw-truncate tw-flex-1 tw-min-w-0">{name}</span>
    {size ? <span className="tw-text-[11px] tw-text-tix-ink-3 tw-flex-none">{formatBytes(size)}</span> : null}
    {onOpen ? (
      <button type="button" className={ATTACHMENT_ACTION} onClick={onOpen} disabled={busy}>
        {busy ? "Opening…" : openLabel}
      </button>
    ) : null}
    {onRemove ? (
      <button type="button" className={ATTACHMENT_ACTION} aria-label="Remove attachment" onClick={onRemove}>
        <Icon icon={xIcon} size={14} />
      </button>
    ) : null}
  </div>
);

// A small, fixed set — Teams' own "quick react" bar, not a full emoji
// keyboard — keeps this to a click instead of a whole picker component.
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// The composer's own emoji picker — a wider curated set than reactions
// (these get typed INTO a message, not tapped onto someone else's), still
// a fixed grid rather than a full emoji keyboard/search.
const COMPOSE_EMOJI = [
  "😀", "😂", "😉", "😍", "🤔", "😢", "😮", "😡",
  "👍", "👎", "🙏", "👏", "🎉", "🔥", "❤️", "✅",
];

// Never send a typing broadcast on every keystroke — once per this window
// is plenty for "someone is typing" to feel live without flooding the
// channel.
const TYPING_BROADCAST_MS = 2500;
// How long a received "typing" broadcast stays true with no follow-up —
// covers a pause mid-sentence without the indicator flickering, and self-
// clears if the other person just closes the tab mid-type.
const TYPING_EXPIRE_MS = 4000;

// Existing reactions only — the "add a reaction" control used to live
// here too, permanently visible under every single message whether or not
// it had any, which is what made the thread read as cluttered rather than
// "a professional built this". It's a MessageMenu action now (see below);
// this renders nothing at all once a message has no reactions yet.
const ReactionChips = ({ message, myUserId, onToggle }) => {
  const counts = {};
  (message.reactions || []).forEach((r) => {
    if (!counts[r.emoji]) counts[r.emoji] = { count: 0, mine: false };
    counts[r.emoji].count += 1;
    if (r.user_id === myUserId) counts[r.emoji].mine = true;
  });
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;

  return (
    <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5 tw-mt-1.5">
      {entries.map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          type="button"
          className={`tw-inline-flex tw-items-center tw-gap-1 tw-text-xs tw-leading-none tw-border tw-border-solid tw-rounded-full tw-py-[3px] tw-px-2 tw-text-tix-ink-2 tw-cursor-pointer hover:tw-brightness-[0.97] ${
            mine
              ? "tw-border-tix-brand tw-bg-[color-mix(in_srgb,var(--tix-brand)_12%,transparent)]"
              : "tw-border-tix-line tw-bg-tix-surface"
          }`}
          onClick={() => onToggle(emoji)}
        >
          {emoji} {count}
        </button>
      ))}
    </div>
  );
};

// The WhatsApp-style "⋮" on every message — React, Reply and Forward for
// anyone, Copy for anyone, Edit/Delete added only for your own and only
// while it's not already soft-deleted. Sits beside the bubble itself (see
// its render site), not on its own meta line, so a grouped message's menu
// doesn't cost an extra visible row the way it used to.
const MessageMenu = ({ message, mine, onReply, onForward, onCopy, onEdit, onDelete, onReact }) => {
  const [open, setOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const menuPanelRef = useRef(null);
  const reactPanelRef = useRef(null);
  const triggerRef = useRef(null);
  const wrapRef = useClickAway(
    open || reactOpen,
    () => { setOpen(false); setReactOpen(false); },
    [menuPanelRef, reactPanelRef]
  );
  // Both panels hang off the same "⋮" trigger, portalled clear of the
  // thread's scroll box — see useAnchoredPopover.
  const menuStyle = useAnchoredPopover(open, triggerRef, menuPanelRef);
  const reactStyle = useAnchoredPopover(reactOpen, triggerRef, reactPanelRef);
  const act = (fn) => {
    setOpen(false);
    fn();
  };

  return (
    <span className="tw-relative tw-flex-none tw-self-end tw-pb-1.5" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="tw-border-none tw-bg-transparent tw-text-tix-ink-3 tw-cursor-pointer tw-text-[15px] tw-leading-none tw-py-0.5 tw-px-1.5 tw-rounded-md tw-opacity-60 hover:tw-bg-tix-surface-2 hover:tw-text-tix-ink hover:tw-opacity-100"
        aria-label="More actions"
        onClick={() => setOpen((v) => !v)}
      >
        {"⋮"}
      </button>
      {open
        ? createPortal(
            <div className={MENU_PANEL} role="menu" ref={menuPanelRef} style={menuStyle}>
              <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); setReactOpen(true); }}>{"React"}</button>
              <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => act(onReply)}>{"Reply"}</button>
              <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => act(onForward)}>{"Forward"}</button>
              {!message.deleted_at ? (
                <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => act(onCopy)}>{"Copy text"}</button>
              ) : null}
              {mine && !message.deleted_at ? (
                <>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => act(onEdit)}>{"Edit"}</button>
                  <button type="button" role="menuitem" className={MENU_ITEM_DANGER} onClick={() => act(onDelete)}>{"Delete"}</button>
                </>
              ) : null}
            </div>,
            document.body
          )
        : null}
      {reactOpen
        ? createPortal(
            <div className={REACTION_PICKER} ref={reactPanelRef} style={reactStyle}>
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={REACTION_PICKER_BTN}
                  onClick={() => {
                    onReact(emoji);
                    setReactOpen(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </span>
  );
};

// How far a message has to be dragged right before letting go of it counts
// as "reply to this", not just an aborted swipe — WhatsApp's own threshold
// reads about the same relative to a phone-width message bubble.
const SWIPE_REPLY_DISTANCE = 56;

// WhatsApp's own signature gesture: drag any message right and let go to
// reply to it — the same result as the "⋮" menu's "Reply", just faster to
// reach with a thumb. Touch-only on purpose (a mouse already has "⋮" →
// Reply, and WhatsApp's own desktop app doesn't do this by dragging with a
// mouse either — it's a phone-specific shortcut, not a replacement for the
// menu, which stays as the reliable, discoverable way in for everyone).
const SwipeToReply = ({ onReply, children }) => {
  const [dragX, setDragX] = useState(0);
  const startRef = useRef(null);
  const draggingRef = useRef(false);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
    draggingRef.current = false;
  };
  const onTouchMove = (e) => {
    if (!startRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    if (!draggingRef.current) {
      // Decided once per touch: a mostly-horizontal, rightward drag claims
      // the gesture as a reply-swipe. Anything else — scrolling the
      // thread, a leftward flick — is left alone so it keeps working
      // exactly as it already did.
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx) || dx < 0) {
        startRef.current = null;
        return;
      }
      draggingRef.current = true;
    }
    // Clamped at BOTH ends. Once the gesture is claimed, dragging back past
    // where the finger started makes dx negative, and an unclamped negative
    // offset slides the message left, out of the thread and off the edge of
    // the card — which is exactly how a half-swiped message ends up stranded
    // there. This gesture only ever moves a message right.
    setDragX(Math.max(0, Math.min(dx, SWIPE_REPLY_DISTANCE * 1.4)));
  };
  const onTouchEnd = () => {
    if (draggingRef.current && dragX >= SWIPE_REPLY_DISTANCE) onReply();
    setDragX(0);
    startRef.current = null;
    draggingRef.current = false;
  };

  return (
    // touchcancel matters as much as touchend here: the browser fires it
    // instead of touchend whenever it takes the gesture over (a scroll
    // winning, an incoming call, the back-swipe edge). Without it the
    // release handler never runs, so the message just stays where the
    // finger left it — permanently offset until something re-renders it.
    <div
      className="tw-relative tw-min-w-0"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <span
        className="tw-absolute tw-left-[-34px] tw-top-1/2 -tw-translate-y-1/2 tw-w-[26px] tw-h-[26px] tw-rounded-full tw-flex tw-items-center tw-justify-center tw-bg-tix-brand tw-text-white tw-pointer-events-none"
        style={{ opacity: Math.min(dragX / SWIPE_REPLY_DISTANCE, 1) }}
        aria-hidden="true"
      >
        <Icon icon={cornerUpLeft} size={16} />
      </span>
      {/* touch-action: pan-y is what lets this gesture coexist with the
          thread's own vertical scrolling — it tells the browser only
          vertical panning is its to handle, leaving horizontal drags to
          the handlers above. Written as an arbitrary property, which takes
          no tw- prefix; easy to drop when rewriting a className by hand,
          and the gesture breaks silently without it. */}
      <div
        className="[touch-action:pan-y]"
        style={{ transform: `translateX(${dragX}px)`, transition: dragX === 0 ? "transform .15s ease" : "none" }}
      >
        {children}
      </div>
    </div>
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
      <ReplyPreview message={message} className="tw-mb-1.5" />
      {channels.length === 0 ? (
        <p className={PICKER_EMPTY}>{"No other chats to forward to yet."}</p>
      ) : (
        <ul className={`${PICKER_LIST} tw-mt-3`}>
          {channels.map((c) => (
            <li key={c.id}>
              <button type="button" className={PICKER_ROW} disabled={busyId === c.id} onClick={() => forward(c.id)}>
                <span className="tix-avatar sm">{initials({ first_name: c.name })}</span>
                <span className={PICKER_ROW_LABEL}>{c.name || "Unnamed channel"}</span>
                {busyId === c.id ? <span>{"Sending…"}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

// Who is in this group, and — for an admin — the controls to change that.
//
// "Admin" here is the 'owner' role on chat_channel_members; the schema has
// only owner/member, and every server-side gate already reads it. Admins are
// equal: any of them can promote, demote or remove any other. The one rule
// the server will not bend on is that a group keeps at least one admin, so
// the last one cannot be demoted or removed (see 169_chat_member_roles.sql) —
// the buttons for that are disabled here too, but the server is what actually
// enforces it.
const ParticipantsModal = ({
  channel,
  members,
  schoolMembers,
  myUserId,
  onClose,
  onChanged,
  onRenamed,
  onError,
}) => {
  const [busyId, setBusyId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState(channel.name || "");

  const memberIds = new Set(members.map((m) => m.user_id));
  const iAmAdmin = members.some((m) => m.user_id === myUserId && m.role === "owner");
  const adminCount = members.filter((m) => m.role === "owner").length;

  const roster = members
    .map((m) => ({ ...m, profile: schoolMembers.find((s) => s.user_id === m.user_id)?.profiles }))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
      return displayName(a.profile).localeCompare(displayName(b.profile));
    });

  const candidates = schoolMembers.filter((s) => {
    if (memberIds.has(s.user_id)) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${displayName(s.profiles)} ${s.role}`.toLowerCase().includes(needle);
  });

  const run = async (id, fn) => {
    setBusyId(id);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      onError(err.message || "That did not work.");
    } finally {
      setBusyId(null);
    }
  };

  const addPicked = () =>
    run("add", async () => {
      await addChatMembers({ channelId: channel.id, memberIds: picked });
      setPicked([]);
      setQuery("");
      setAdding(false);
    });

  const renameDirty = name.trim() !== (channel.name || "").trim();

  const rename = () =>
    run("rename", async () => {
      await renameChatChannel({ channelId: channel.id, name });
      // The header and the list row both read the name from chat_overview,
      // not from this modal, so the channel list has to be refetched or the
      // new name only exists in this input.
      await onRenamed();
    });

  return (
    <Modal title={channel.name?.trim() || "Group"} subtitle={`${members.length} participants`} onClose={onClose}>
      {iAmAdmin ? (
        <div className="tw-mb-4">
          <label className="tw-block tw-text-xs tw-text-ink-3 tw-mb-1.5">{"Group name"}</label>
          <div className="tw-flex tw-gap-2">
            <input
              className="input tw-flex-1 tw-min-w-0"
              value={name}
              placeholder="Group name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameDirty && name.trim()) {
                  e.preventDefault();
                  rename();
                }
              }}
            />
            <Button
              size="sm"
              disabled={!renameDirty || !name.trim() || busyId !== null}
              onClick={rename}
            >
              {busyId === "rename" ? "Saving..." : "Rename"}
            </Button>
          </div>
        </div>
      ) : null}

      <ul className={PICKER_LIST}>
        {roster.map((m) => {
          const isMe = m.user_id === myUserId;
          const isAdmin = m.role === "owner";
          // Refused by the server anyway; disabled here so the only admin is
          // not invited to click something that cannot succeed.
          const lastAdmin = isAdmin && adminCount <= 1;
          return (
            <li key={m.user_id}>
              <div className={`${PICKER_ROW} tw-cursor-default`}>
                <span className="tix-avatar sm">{initials(m.profile)}</span>
                <span className={PICKER_ROW_LABEL}>
                  {displayName(m.profile)}{isMe ? " (you)" : ""}
                  {isAdmin ? (
                    <span className="tw-ml-2 tw-text-[11px] tw-font-semibold tw-text-brand-dark">{"Admin"}</span>
                  ) : null}
                </span>
                {iAmAdmin ? (
                  <span className="tw-flex tw-flex-none tw-gap-1">
                    <button
                      type="button"
                      className={MENU_ITEM}
                      disabled={busyId !== null || lastAdmin}
                      onClick={() =>
                        run(m.user_id, () =>
                          setChatMemberRole({
                            channelId: channel.id,
                            userId: m.user_id,
                            role: isAdmin ? "member" : "owner",
                          })
                        )
                      }
                    >
                      {isAdmin ? "Remove admin" : "Make admin"}
                    </button>
                    <button
                      type="button"
                      className={MENU_ITEM_DANGER}
                      disabled={busyId !== null || lastAdmin}
                      onClick={() =>
                        run(m.user_id, () => removeChatMember({ channelId: channel.id, userId: m.user_id }))
                      }
                    >
                      {"Remove"}
                    </button>
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {iAmAdmin ? (
        <div className="tw-mt-4">
          {!adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>{"Add people"}</Button>
          ) : (
            <>
              {schoolMembers.length > 6 ? (
                <input
                  className="input tw-w-full tw-mb-2 tw-py-[7px] tw-px-2.5 tw-text-[13.5px]"
                  placeholder="Search by name or role..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              ) : null}
              {candidates.length === 0 ? (
                <p className={PICKER_EMPTY}>{"Everyone here is already in this group."}</p>
              ) : (
                <ul className={PICKER_LIST}>
                  {candidates.map((s) => {
                    const checked = picked.includes(s.user_id);
                    return (
                      <li key={s.user_id}>
                        <button
                          type="button"
                          className={`${PICKER_ROW} ${checked ? PICKER_ROW_SELECTED : ""}`}
                          onClick={() =>
                            setPicked((cur) =>
                              cur.includes(s.user_id)
                                ? cur.filter((id) => id !== s.user_id)
                                : [...cur, s.user_id]
                            )
                          }
                        >
                          <span className="tix-avatar sm">{initials(s.profiles)}</span>
                          <span className={PICKER_ROW_LABEL}>
                            {displayName(s.profiles)} · {s.role}
                          </span>
                          {checked ? <Icon icon={check} size={16} /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="btn-row tw-mt-3">
                <Button size="sm" disabled={picked.length === 0 || busyId !== null} onClick={addPicked}>
                  {busyId === "add" ? "Adding..." : `Add ${picked.length || ""}`.trim()}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setAdding(false); setPicked([]); setQuery(""); }}
                >
                  {"Cancel"}
                </Button>
              </div>
            </>
          )}
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

  // What is still missing, in the order someone fills the form in, so the hint
  // names one thing at a time rather than listing everything at once.
  const blockedReason =
    mode === "dm"
      ? otherUserId
        ? ""
        : "Pick someone to message."
      : !groupName.trim()
      ? "Give the group a name."
      : groupMemberIds.length === 0
      ? "Pick at least one person."
      : "";

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
            <p className={PICKER_EMPTY}>{"No one else here yet."}</p>
          ) : visibleMembers.length === 0 ? (
            <p className={PICKER_EMPTY}>{"No one matches that search."}</p>
          ) : (
            <ul className={PICKER_LIST}>
              {visibleMembers.map((m) => (
                <li key={m.user_id}>
                  <button
                    type="button"
                    className={`${PICKER_ROW} ${otherUserId === m.user_id ? PICKER_ROW_SELECTED : ""}`}
                    onClick={() => setOtherUserId(m.user_id)}
                  >
                    <span className="tix-avatar sm">{initials(m.profiles)}</span>
                    <span className={PICKER_ROW_LABEL}>
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
              // Named as required: it sits below the search box, so it is easy
              // to tick people and never notice this was skipped.
              placeholder="Channel name (required)"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            {members.length === 0 ? (
              <p className={PICKER_EMPTY}>{"No one else here yet."}</p>
            ) : visibleMembers.length === 0 ? (
              <p className={PICKER_EMPTY}>{"No one matches that search."}</p>
            ) : (
              <ul className={PICKER_LIST}>
                {visibleMembers.map((m) => {
                  const checked = groupMemberIds.includes(m.user_id);
                  return (
                    <li key={m.user_id}>
                      <button
                        type="button"
                        className={`${PICKER_ROW} ${checked ? PICKER_ROW_SELECTED : ""}`}
                        onClick={() => toggleGroupMember(m.user_id)}
                      >
                        <span className="tix-avatar sm">{initials(m.profiles)}</span>
                        <span className={PICKER_ROW_LABEL}>
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

        {/* A disabled button with nothing beside it just reads as broken —
            with two people already ticked and the name box still empty, the
            obvious conclusion is that the button itself does not work. Say
            which part is missing instead. */}
        <div className="tw-mt-4">
          <Button type="submit" disabled={busy || !!blockedReason}>
            {busy ? "Starting..." : mode === "dm" ? "Start chat" : "Create group"}
          </Button>
          {blockedReason ? (
            <span className="tw-ml-3 tw-text-[12.5px] tw-text-ink-3">{blockedReason}</span>
          ) : null}
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
  const [chatQuery, setChatQuery] = useState("");
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
  const [showParticipants, setShowParticipants] = useState(false);
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
  const composerRef = useRef(null);
  const [showFormatting, setShowFormatting] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const emojiWrapRef = useClickAway(emojiPickerOpen, () => setEmojiPickerOpen(false));
  const typingChannelRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const typingTimeoutsRef = useRef({});

  const openPerson = (userId) => {
    const person = schoolMembers.find((m) => m.user_id === userId);
    if (person) setViewingPerson(person);
  };

  // Returns the promise so a caller that needs the list to be current before
  // it continues — renaming a group, which only shows up once chat_overview
  // is refetched — can await it instead of racing the refresh.
  const loadOverview = useCallback(() => {
    if (!schoolId) return Promise.resolve();
    return fetchChatOverview(schoolId)
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
  //
  // Two subscriptions, not one: subscribeToMyChannels only ever fires on a
  // change to MY OWN chat_channel_members row (a membership add/remove, my
  // own last_read_at), which someone else's new message never touches —
  // subscribeToSchoolChatActivity is what actually reacts to a new message
  // arriving in a channel I'm not currently looking at.
  useEffect(() => {
    if (!user?.id || !schoolId) return undefined;
    const membershipChannel = subscribeToMyChannels(user.id, () => loadOverview());
    const activityChannel = subscribeToSchoolChatActivity(schoolId, () => loadOverview());
    return () => {
      membershipChannel.unsubscribe();
      activityChannel.unsubscribe();
    };
  }, [user?.id, schoolId, loadOverview]);

  // Returns the promise so callers that need the roster to be current before
  // they continue (the participants modal, after an add/remove/promote) can
  // await it, rather than racing the realtime subscription to the same data.
  const loadChannelMembers = useCallback(() => {
    if (!channelId) return Promise.resolve();
    return fetchChannelMembers(channelId).then(setChannelMembers).catch(() => {});
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
  // One place a file becomes the pending attachment, whether it arrived from
  // the paperclip or was dropped onto the conversation.
  const attachFile = (file) => {
    if (!file) return;
    if (pendingFile) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile({ file, name: file.name, size: file.size, previewUrl: URL.createObjectURL(file) });
    // A caption is optional — an attachment alone is a complete message, and
    // everything from the send button down already allows that. But picking a
    // file through the paperclip or a drop leaves focus outside the editor, so
    // Enter went nowhere and it looked as though a picture could not be sent
    // until something was typed. Putting the cursor in the composer makes
    // Enter send the attachment on its own.
    composerRef.current?.focus();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    attachFile(file);
  };

  // Drag and drop onto the open conversation.
  //
  // dragenter/dragleave fire for every child element the pointer crosses, so
  // a plain boolean flickers off the moment the cursor passes over a message
  // bubble. Counting enters against leaves is what keeps the overlay steady
  // while the pointer moves around inside the thread.
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  // Only react to an actual file drag. Dragging selected text, or a link from
  // another tab, should not put the composer into "drop a file here" mode.
  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

  const onDragEnter = (e) => {
    if (!channelId || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const onDragOver = (e) => {
    if (!channelId || !isFileDrag(e)) return;
    // Without preventDefault on dragover the browser refuses the drop and
    // opens the file in a new tab instead.
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (e) => {
    if (!channelId || !isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const onDrop = (e) => {
    if (!channelId || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    // One attachment per message, same as the paperclip allows, so take the
    // first and say so rather than silently dropping the rest.
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    attachFile(files[0]);
    if (files.length > 1) setError("One file per message — the first one was attached.");
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

  // chat-attachments is a private bucket, so an <img> cannot just point at a
  // stored path — every picture needs its own signed URL before it will
  // render. Fetched once per path as messages arrive and kept here, with a
  // ref tracking what has already been asked for so a re-render (a new
  // message, a reaction) does not re-sign every image in the thread.
  //
  // An hour rather than the 5 minutes openAttachment uses: that one is
  // fetched at the moment of clicking and used immediately, whereas these sit
  // on screen for as long as the thread stays open.
  const [imageUrls, setImageUrls] = useState({});
  const imageFetchedRef = useRef(new Set());

  useEffect(() => {
    const todo = messages
      .filter((m) => !m.deleted_at && m.attachment_path && isImagePath(m.attachment_path))
      .map((m) => m.attachment_path)
      .filter((path) => !imageFetchedRef.current.has(path));
    if (todo.length === 0) return;
    todo.forEach((path) => imageFetchedRef.current.add(path));
    Promise.all(
      todo.map((path) =>
        signedChatAttachmentUrl(path, 3600)
          .then((url) => [path, url])
          .catch(() => [path, null])
      )
    ).then((pairs) => {
      setImageUrls((current) => {
        const next = { ...current };
        pairs.forEach(([path, url]) => {
          if (url) next[path] = url;
        });
        return next;
      });
    });
  }, [messages]);

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

  // chat_overview names a DM by the OTHER person, and a group by its own
  // name (see its own comment) — one field, one search box, covers "find
  // someone's name" and "find a group chat" without telling the two apart.
  const filteredChannels = useMemo(() => {
    const needle = chatQuery.trim().toLowerCase();
    if (!needle) return channels;
    return channels.filter((c) => (c.name || "").toLowerCase().includes(needle));
  }, [channels, chatQuery]);

  const activeChannel = channels.find((c) => c.id === channelId);
  const myProfile = membersById[user?.id];
  // The other side of a DM — chat_overview never names them (it returns
  // the channel's display name, not a user id), but the roster fetched for
  // "seen" already has every member of THIS open channel.
  //
  // Only ever meaningful for a DM. Unguarded, "the first member who isn't me"
  // resolves on a GROUP too, to whichever member the roster happened to return
  // first — so opening a group called "Testing one or two" and clicking its
  // header showed one arbitrary participant's profile card.
  const otherMemberId =
    activeChannel?.kind === "dm"
      ? channelMembers.find((m) => m.user_id !== user?.id)?.user_id
      : undefined;
  // The open group's own roster is already loaded here, so the header cluster
  // uses it directly rather than chat_overview's capped member_preview. Same
  // ordering rule as that column (joined order, then id) so a group looks the
  // same in the header as it does in the list beside it.
  const headerGroupProfiles = channelMembers
    .filter((m) => m.user_id !== user?.id)
    .slice()
    .sort(
      (a, b) =>
        String(a.joined_at || "").localeCompare(String(b.joined_at || "")) ||
        String(a.user_id).localeCompare(String(b.user_id))
    )
    .slice(0, 3)
    .map((m) => membersById[m.user_id])
    .filter(Boolean);

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
        {/* A real phone chat app shows one pane at a time — the chat list, or
            (once you tap into one) that conversation full-screen with a back
            arrow, never both stacked down one page, which is what the generic
            .tix-detail mobile rule does for Tickets. Which pane shows is
            driven straight off channelId rather than a toggle class with
            descendant selectors: it is the same signal the old
            .chat-mobile-open class was derived from, and reading it here
            means the two panes cannot disagree about which one is visible.
            Every mobile: utility below is max-width 900px (see
            tailwind.config.js), matching this app's desktop-first CSS. */}
        <div className="tix-shell tix-detail tw-grid-cols-[300px_1fr] mobile:tw-grid-cols-[1fr] mobile:tw-grid-rows-[minmax(0,1fr)] mobile:tw-h-[var(--page-avail-h,calc(100vh-68px-var(--page-top-h,0px)-40px))]">
          <aside
            className={`tix-detail-list mobile:tw-h-full mobile:tw-overflow-y-auto mobile:tw-border-r-0 mobile:tw-border-b-0 ${
              channelId ? "mobile:tw-hidden" : ""
            }`}
          >
            <div className="tw-flex tw-justify-between tw-items-center tw-mb-2.5">
              <strong>{"Chats"}</strong>
              <Button size="sm" onClick={() => setShowNewChat(true)}>{"New"}</Button>
            </div>
            {channels.length > 0 ? (
              <input
                className="input tw-w-full tw-mb-2 tw-py-[7px] tw-px-2.5 tw-text-[13.5px]"
                placeholder="Search chats"
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
              />
            ) : null}
            {channels.length === 0 ? (
              <Empty>{"No chats yet. Start one with “New” above."}</Empty>
            ) : filteredChannels.length === 0 ? (
              <Empty>{"No chats match that search."}</Empty>
            ) : (
              filteredChannels.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  className={`tw-flex tw-items-start tw-gap-2.5 tw-w-full tw-text-left tw-py-[9px] tw-px-2 tw-rounded-[8px] tw-border-0 tw-border-solid tw-border-l-[3px] tw-cursor-pointer [font-family:inherit] hover:tw-bg-tix-surface-2 ${
                    c.id === channelId
                      ? "tw-bg-tix-surface-2 tw-border-l-tix-brand"
                      : "tw-bg-transparent tw-border-l-transparent"
                  }`}
                  onClick={() => navigate(`/Chat/${c.id}`)}
                  onKeyDown={(e) => { if (e.key === "Enter") navigate(`/Chat/${c.id}`); }}
                >
                  {c.kind === "group" ? (
                    <span className="tw-flex-none tw-mt-0.5">
                      {/* filter(Boolean): the school roster loads separately,
                          so before it arrives these ids resolve to undefined
                          and would each render a "SO" (initials of "Someone")
                          circle. Dropping them shows fewer faces for a moment
                          instead of wrong ones. */}
                      <GroupAvatar
                        profiles={(c.member_preview || []).map((id) => membersById[id]).filter(Boolean)}
                        size={34}
                      />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`tix-avatar ${AVATAR_BTN}`}
                      disabled={!c.other_user_id}
                      onClick={(e) => { e.stopPropagation(); if (c.other_user_id) openPerson(c.other_user_id); }}
                    >
                      {initials({ first_name: c.name })}
                    </button>
                  )}
                  <span className="tw-flex-1 tw-min-w-0">
                    <span className="tw-flex tw-items-baseline tw-justify-between tw-gap-2">
                      <span
                        className={`tw-text-[13.5px] tw-truncate ${
                          c.unread_count > 0 ? "tw-font-bold tw-text-tix-ink" : "tw-text-tix-ink-2"
                        }${c.other_user_id ? ` ${CLICKABLE_NAME}` : ""}`}
                        onClick={c.other_user_id ? (e) => { e.stopPropagation(); openPerson(c.other_user_id); } : undefined}
                      >
                        {c.name?.trim() || "Unnamed channel"}
                      </span>
                      <span className="tw-flex-none tw-text-[11px] tw-text-tix-ink-3">{shortTimestamp(c.last_message_at)}</span>
                    </span>
                    <span className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-mt-0.5">
                      {/* Typing only ever exists for the channel actually
                          open right now — subscribeToTyping only listens
                          on channelId, not every channel in the list — so
                          this can only ever apply to that one row. */}
                      {c.id === channelId && typingNames.length > 0 ? (
                        <span className={`${TYPING} tw-truncate`}>{`${typingNames.join(", ")} ${typingNames.length > 1 ? "are" : "is"} typing…`}</span>
                      ) : (
                        <span className="tw-text-xs tw-text-tix-ink-3 tw-truncate">
                          {(c.last_message_preview || "No messages yet").replace(/<[^>]+>/g, "")}
                        </span>
                      )}
                      {/* The bold name alone reads as "different", not
                          "unread", at a glance — this dot is the actual
                          unread signal, same shape as the sidebar's own
                          Chat-link dot, so both places agree on what
                          "unread" looks like. */}
                      {c.unread_count > 0 ? (
                        <span
                          className="tw-flex-none tw-w-2 tw-h-2 tw-rounded-full tw-bg-tix-brand"
                          title={`${c.unread_count} unread`}
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </span>
                </div>
              ))
            )}
          </aside>

          <section
            className={`tix-thread tw-relative tw-flex tw-flex-col tw-p-0 tw-overflow-y-hidden mobile:tw-h-full mobile:tw-overflow-y-auto mobile:tw-border-r-0 mobile:tw-border-b-0 ${
              channelId ? "" : "mobile:tw-hidden"
            }`}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {/* Covers the whole conversation, not just the composer: dropping
                onto the messages is where the hand naturally goes. pointer-
                events-none so it never swallows the drop it is advertising. */}
            {dragActive ? (
              <div className="tw-absolute tw-inset-0 tw-z-50 tw-pointer-events-none tw-flex tw-items-center tw-justify-center tw-bg-[color-mix(in_srgb,var(--tix-brand)_10%,transparent)] tw-border-2 tw-border-dashed tw-border-tix-brand tw-rounded-[10px]">
                <span className="tw-px-4 tw-py-2 tw-rounded-full tw-bg-tix-surface tw-text-[13.5px] tw-text-tix-ink tw-shadow-2">
                  {"Drop to attach"}
                </span>
              </div>
            ) : null}
            {!channelId ? (
              <div className="tw-flex-1 tw-flex tw-items-center tw-justify-center">
                <Empty>{"Pick a chat on the left, or start a new one."}</Empty>
              </div>
            ) : loading ? (
              <div className="tw-flex-1 tw-flex tw-items-center tw-justify-center">
                <Empty>{"Loading..."}</Empty>
              </div>
            ) : (
              <>
                <div className="tw-flex-none tw-flex tw-items-center tw-gap-3 tw-py-3.5 tw-px-5 tw-border-0 tw-border-solid tw-border-b-[1px] tw-border-b-tix-line tw-min-h-[30px]">
                  {/* Only reachable once mobile hides the list behind the open
                      thread — on a wide screen both panes already show, so it
                      would only duplicate the list's own "New" button. */}
                  <button
                    type="button"
                    className="tw-hidden mobile:tw-inline-flex tw-flex-none tw-w-8 tw-h-8 tw-rounded-full tw-border-none tw-bg-transparent tw-items-center tw-justify-center tw-text-tix-ink-2 tw-cursor-pointer tw-mr-0.5 hover:tw-bg-tix-surface-2"
                    aria-label="Back to chats"
                    onClick={() => navigate("/Chat")}
                  >
                    <Icon icon={arrowLeft} size={18} />
                  </button>
                  {activeChannel?.kind === "group" ? (
                    <button
                      type="button"
                      className={`tw-flex-none tw-border-none tw-bg-transparent tw-p-0 tw-cursor-pointer [font-family:inherit]`}
                      aria-label="Participants"
                      onClick={() => setShowParticipants(true)}
                    >
                      <GroupAvatar profiles={headerGroupProfiles} size={38} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`tix-avatar tw-w-[38px] tw-h-[38px] tw-text-[13.5px] tw-shadow-1 ${AVATAR_BTN}`}
                      disabled={!otherMemberId}
                      onClick={() => otherMemberId && openPerson(otherMemberId)}
                    >
                      {initials({ first_name: activeChannel?.name })}
                    </button>
                  )}
                  <div>
                    <h1
                      className={`tw-text-base tw-m-0 tw-text-tix-ink [font-family:inherit] tw-leading-[1.3] ${
                        otherMemberId ? CLICKABLE_NAME : ""
                      }`}
                      onClick={() => otherMemberId && openPerson(otherMemberId)}
                    >
                      {activeChannel?.name?.trim() || "Chat"}
                    </h1>
                    {typingNames.length > 0 ? (
                      <div className={TYPING}>{`${typingNames.join(", ")} ${typingNames.length > 1 ? "are" : "is"} typing…`}</div>
                    ) : null}
                  </div>
                  {/* Groups only — a DM's "participants" are the two people
                      already named in this header. */}
                  {activeChannel?.kind === "group" ? (
                    <button
                      type="button"
                      className={`${CLICKABLE_NAME} tw-ml-auto tw-flex-none tw-border-none tw-bg-transparent tw-text-[12.5px] tw-text-tix-ink-3 [font-family:inherit]`}
                      onClick={() => setShowParticipants(true)}
                    >
                      {`${channelMembers.length} participants`}
                    </button>
                  ) : null}
                </div>

                <div className="tw-flex-1 tw-min-h-0 tw-overflow-y-auto tw-py-[18px] tw-px-[22px]">
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
                      <div
                        key={m.id}
                        className={`tw-flex tw-gap-2.5 tw-max-w-[74%] tw-my-[3px] ${
                          grouped ? "tw-mt-0" : ""
                        } ${mine ? "tw-ml-auto tw-flex-row-reverse" : ""}`}
                      >
                        {/* Your own avatar is dropped on a phone — the bubble's
                            own colour and right alignment already say "mine",
                            and the repeated circle only costs width there. */}
                        <button
                          type="button"
                          className={`tix-avatar sm tw-mt-0.5 tw-flex-none ${AVATAR_BTN} ${
                            grouped ? "tw-invisible" : ""
                          } ${mine ? "mobile:tw-hidden" : ""}`}
                          onClick={() => openPerson(mine ? user.id : m.author_id)}
                        >
                          {mine ? initials(myProfile) : initials(m.author)}
                        </button>
                        <div className={`tw-flex tw-flex-col tw-gap-0.5 tw-min-w-0 ${mine ? "tw-items-end" : ""}`}>
                          {!grouped ? (
                            <div className="tw-flex tw-items-baseline tw-gap-2 tw-mb-px">
                              <strong
                                className={`tw-text-[12.5px] tw-text-tix-ink ${CLICKABLE_NAME}`}
                                onClick={() => openPerson(mine ? user.id : m.author_id)}
                              >
                                {mine ? "You" : displayName(m.author)}
                              </strong>
                              <span className="tw-text-[11px] tw-text-tix-ink-3">
                                {shortTimestamp(m.created_at)}{m.edited_at ? " · edited" : ""}
                              </span>
                            </div>
                          ) : null}
                          {/* The menu sits beside the bubble itself, not on
                              its own meta line — a grouped message (no name/
                              time shown above it) used to still get a whole
                              extra row just to hold this one small button,
                              which is most of what made the thread read as
                              cluttered rather than "a professional built
                              this". row-reverse for "mine" puts it on the
                              outer edge, away from the bubble's own corner,
                              on both sides. */}
                          <div
                            className={`tw-flex tw-items-end tw-gap-0.5 tw-min-w-0 ${
                              mine ? "tw-flex-row-reverse" : ""
                            }`}
                          >
                            <SwipeToReply onReply={() => setReplyingTo(m)}>
                              <div
                                className={`tw-flex tw-flex-col tw-gap-[3px] tw-min-w-0 ${
                                  mine ? "tw-items-end" : ""
                                }`}
                              >
                                {m.deleted_at ? (
                                  <div className="tw-rounded-[14px] tw-py-2 tw-px-[13px] tw-bg-transparent tw-border tw-border-dashed tw-border-tix-line tw-text-tix-ink-3 tw-italic">
                                    {"Message deleted."}
                                  </div>
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
                                    {m.reply_to ? <ReplyPreview message={m.reply_to} className={REPLY_QUOTE} /> : null}
                                    {!isHtmlEmpty(m.body) ? (
                                      <div
                                        // tix-msg-html stays a real CSS class:
                                        // it styles the p/ul/a tags Tiptap
                                        // generates inside this bubble, which
                                        // have no JSX call site to take a
                                        // className. The link colour override
                                        // for "mine" needs the same treatment,
                                        // hence the [&_a] arbitrary variant.
                                        className={`tw-rounded-[14px] tw-py-2 tw-px-[13px] tix-msg-html ${
                                          mine
                                            ? "tw-bg-tix-brand tw-text-white [&_a]:tw-text-white"
                                            : "tw-bg-tix-surface-2 tw-text-tix-ink-2"
                                        }`}
                                        // Instagram/WhatsApp's other signature
                                        // gesture — double-tap a message to
                                        // heart it, the same toggle the "⋮"
                                        // menu's own React item already
                                        // calls. A shortcut onto existing
                                        // behaviour, not a new one.
                                        onDoubleClick={() => toggleReaction(m, "❤️")}
                                        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(m.body) }}
                                      />
                                    ) : null}
                                    {/* A picture shows as a picture. The chip
                                        is right for a spreadsheet nobody can
                                        preview from its name, but it made an
                                        image something you had to open to
                                        find out what it was. Tapping it still
                                        opens the same full viewer. */}
                                    {m.attachment_path && isImagePath(m.attachment_path) ? (
                                      <button
                                        type="button"
                                        className="tw-block tw-mt-1.5 tw-p-0 tw-border-none tw-bg-transparent tw-cursor-pointer tw-rounded-[10px] tw-overflow-hidden tw-max-w-[420px]"
                                        onClick={() => openAttachment(m)}
                                        title={m.attachment_name || "Open image"}
                                      >
                                        {imageUrls[m.attachment_path] ? (
                                          // Sized like a shared screenshot
                                          // rather than a thumbnail — the
                                          // point of one is usually that it
                                          // is readable in place. Natural
                                          // size up to the caps, so a small
                                          // image is not stretched; max-w
                                          // also keeps it inside the row's
                                          // own 74% on a narrow screen, and
                                          // the height cap stops a tall
                                          // screenshot taking over the thread.
                                          <img
                                            src={imageUrls[m.attachment_path]}
                                            alt={m.attachment_name || "Image"}
                                            className="tw-block tw-max-w-full tw-max-h-[360px] tw-object-contain tw-rounded-[10px]"
                                          />
                                        ) : (
                                          // Same footprint as the image that
                                          // replaces it, so the thread does
                                          // not jump as pictures resolve.
                                          <span className="tw-flex tw-items-center tw-justify-center tw-w-[180px] tw-h-[120px] tw-rounded-[10px] tw-bg-tix-surface-2 tw-text-xs tw-text-tix-ink-3">
                                            {"Loading image…"}
                                          </span>
                                        )}
                                      </button>
                                    ) : m.attachment_path ? (
                                      <AttachmentChip
                                        name={m.attachment_name}
                                        size={m.attachment_size}
                                        busy={openingAttachmentId === m.id}
                                        onOpen={() => openAttachment(m)}
                                      />
                                    ) : null}
                                    <ReactionChips message={m} myUserId={user?.id} onToggle={(emoji) => toggleReaction(m, emoji)} />
                                  </>
                                )}
                              </div>
                            </SwipeToReply>
                            {!m.deleted_at ? (
                              <MessageMenu
                                message={m}
                                mine={mine}
                                onReply={() => setReplyingTo(m)}
                                onForward={() => setForwardMessage(m)}
                                onCopy={() => copyMessageText(m)}
                                onEdit={() => { setEditingId(m.id); setEditBody(m.body); }}
                                onDelete={() => remove(m.id)}
                                onReact={(emoji) => toggleReaction(m, emoji)}
                              />
                            ) : null}
                          </div>
                          {seen ? (
                            <div className="tw-text-[11px] tw-text-tix-ink-3 tw-mt-0.5 tw-text-right">{"Seen"}</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={threadEndRef} />
                </div>

                <form
                  onSubmit={send}
                  className="tw-flex-none tw-border-0 tw-border-solid tw-border-t-[1px] tw-border-t-tix-line tw-pt-3 tw-px-5 tw-pb-4 tw-bg-tix-surface"
                >
                  {replyingTo ? (
                    <div className="tw-flex tw-items-center tw-gap-2 tw-mb-1.5">
                      <ReplyPreview message={replyingTo} className={`${REPLY_QUOTE} tw-flex-1 tw-mb-0`} />
                      <button
                        type="button"
                        className="tw-flex-none tw-border-none tw-bg-transparent tw-text-tix-ink-3 tw-cursor-pointer"
                        aria-label="Cancel reply"
                        onClick={() => setReplyingTo(null)}
                      >
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
                  <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
                  <div className="tw-flex tw-items-end tw-gap-1.5 tw-border tw-border-solid tw-border-tix-line tw-rounded-[22px] tw-py-1.5 tw-pr-2 tw-pl-4 tw-bg-tix-surface-2 focus-within:tw-border-tix-brand">
                    {/* chat-composer-input stays a real class: theme.css uses
                        it to reach inside RichTextEditor's own markup
                        (.rte-compact .rte-prose), which has no JSX call site
                        here to take a className. */}
                    <div className="chat-composer-input tw-flex-1 tw-min-w-0">
                      <RichTextEditor
                        ref={composerRef}
                        value={composeBody}
                        onChange={(html) => { setComposeBody(html); notifyTyping(); }}
                        placeholder="Type a message..."
                        onSubmitEditor={send}
                        showToolbar={showFormatting}
                      />
                    </div>
                    <div className="tw-flex tw-items-center tw-gap-0.5 tw-flex-none tw-pb-0.5">
                      <button
                        type="button"
                        className={`${ICON_BTN} ${
                          showFormatting
                            ? "tw-bg-[color-mix(in_srgb,var(--tix-brand)_16%,transparent)] tw-text-tix-brand"
                            : ""
                        }`}
                        aria-label="Formatting"
                        title="Formatting"
                        onClick={() => setShowFormatting((v) => !v)}
                      >
                        <Icon icon={formatIcon} size={17} />
                      </button>
                      <span className="tw-relative tw-inline-flex" ref={emojiWrapRef}>
                        <button
                          type="button"
                          className={ICON_BTN}
                          aria-label="Emoji"
                          title="Emoji"
                          onClick={() => setEmojiPickerOpen((v) => !v)}
                        >
                          {"🙂"}
                        </button>
                        {/* repeat(8,1fr), NOT Tailwind's grid-cols-8 — that
                            compiles to repeat(8, minmax(0,1fr)), and a zero
                            minimum lets the tracks collapse in this panel,
                            which is absolutely positioned and so sizes to its
                            content. Plain 1fr means minmax(auto,1fr), so each
                            track stays at least as wide as the emoji in it and
                            the grid lays out 8 across as intended. */}
                        {emojiPickerOpen ? (
                          <div className="tw-absolute tw-bottom-[calc(100%+8px)] tw-right-0 tw-z-30 tw-grid tw-grid-cols-[repeat(8,1fr)] tw-gap-0.5 tw-p-2 tw-border tw-border-solid tw-border-tix-line tw-rounded-[10px] tw-bg-tix-surface tw-shadow-1">
                            {COMPOSE_EMOJI.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                className="tw-border-none tw-bg-transparent tw-text-[18px] tw-p-1 tw-cursor-pointer tw-rounded-md hover:tw-bg-tix-surface-2"
                                onClick={() => {
                                  composerRef.current?.insertContent(emoji);
                                  setEmojiPickerOpen(false);
                                }}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        className={ICON_BTN}
                        aria-label="Attach a file"
                        title="Attach a file"
                        disabled={!!pendingFile}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Icon icon={paperclip} size={17} />
                      </button>
                      <button
                        type="submit"
                        className="tw-flex-none tw-w-[34px] tw-h-[34px] tw-rounded-full tw-border-none tw-cursor-pointer tw-flex tw-items-center tw-justify-center tw-bg-tix-brand tw-text-white disabled:tw-opacity-50 disabled:tw-cursor-not-allowed enabled:hover:tw-brightness-[1.08]"
                        disabled={sending || (isHtmlEmpty(composeBody) && !pendingFile)}
                        aria-label="Send"
                        title="Send"
                      >
                        <Icon icon={sendIcon} size={16} />
                      </button>
                    </div>
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

      {showParticipants && activeChannel ? (
        <ParticipantsModal
          channel={activeChannel}
          members={channelMembers}
          schoolMembers={schoolMembers}
          myUserId={user?.id}
          onClose={() => setShowParticipants(false)}
          onChanged={loadChannelMembers}
          onRenamed={loadOverview}
          onError={setError}
        />
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
