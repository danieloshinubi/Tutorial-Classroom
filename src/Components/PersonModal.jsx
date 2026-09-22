import React, { useEffect, useState } from "react";
import { Modal, displayName, initials } from "./UI";
import { findTopOfChain } from "../lib/orgChart";

// One card in the Organisation section — a photo (or initials) above a
// name and role, the same "Manager" / "People reporting to X" layout
// Teams' own profile card uses. Clicking any card re-points the SAME
// modal at that person (Teams' own click-through) — there is no page to
// navigate to here; the whole chain is walked inside this one card.
//
// Tailwind utilities here use the global brand/ink/surface tokens, never
// the --tix-* aliases — this modal also renders from SchoolAdmin's org
// chart panel, OUTSIDE .tix-shell, where --tix-* is never defined (see
// the equivalent note that used to live on the theme.css rule this
// replaced). .tix-avatar itself stays a real CSS class (not converted) —
// it's used far outside Chat's own Tailwind content scope, so Tailwind
// never generates a replacement for it.
//
// Named utilities carry the tw- prefix (see tailwind.config.js for why);
// arbitrary PROPERTIES like [font:inherit] deliberately do not, because
// Tailwind does not prefix those and silently emits nothing if you add it.
const PersonCard = ({ person, onClick }) => (
  <button
    type="button"
    className="tw-group tw-flex-none tw-w-[84px] tw-flex tw-flex-col tw-items-center tw-text-center tw-gap-1.5 tw-border-none tw-bg-transparent tw-p-1.5 tw-rounded-[10px] tw-cursor-pointer [font:inherit] hover:tw-bg-bg"
    onClick={onClick}
  >
    {person.profiles?.avatar_url ? (
      <img src={person.profiles.avatar_url} alt="" className="tix-avatar tw-w-[52px] tw-h-[52px] tw-object-cover" />
    ) : (
      <span className="tix-avatar tw-w-[52px] tw-h-[52px] tw-text-base">{initials(person.profiles)}</span>
    )}
    <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink tw-line-clamp-2 group-hover:tw-text-brand-dark">
      {displayName(person.profiles)}
    </span>
    <span className="tw-text-[11px] tw-text-ink-3 tw-capitalize tw-overflow-hidden tw-text-ellipsis tw-whitespace-nowrap tw-max-w-full">
      {person.role}
    </span>
  </button>
);

// The "Teams-style" who-is-this card — role and reporting line come
// straight out of a schoolMembers list the caller already loaded (Chat
// resolves message authors from it; the org chart fetches it directly),
// no extra fetch of its own. Shared by ChatPage.jsx and SchoolAdmin's org
// chart panel so both show the exact same card for the exact same person.
//
// `viewing` is internal state, not just the `person` prop directly — this
// is what lets clicking a manager or a direct report re-point the SAME
// open card at THEM, without the caller having to track who's currently
// shown, and without ever leaving this modal for a separate page. It
// resets to `person` whenever the caller opens the card on someone new (a
// different prop identity), but clicks inside the card move it
// independently of that prop.
const PersonModal = ({ person, schoolMembers, onClose }) => {
  const [viewing, setViewing] = useState(person);
  useEffect(() => setViewing(person), [person]);

  const manager = viewing.manager_id ? schoolMembers.find((m) => m.user_id === viewing.manager_id) : null;
  const reports = schoolMembers.filter((m) => m.manager_id === viewing.user_id);
  const top = findTopOfChain(viewing.user_id, schoolMembers);
  const isTop = !manager;

  return (
    <Modal title="Profile" onClose={onClose}>
      <div className="tw-flex tw-items-center tw-gap-3.5 tw-mb-[18px]">
        {viewing.profiles?.avatar_url ? (
          <img src={viewing.profiles.avatar_url} alt="" className="tix-avatar tw-w-[52px] tw-h-[52px] tw-object-cover" />
        ) : (
          <span className="tix-avatar tw-w-[52px] tw-h-[52px] tw-text-[18px]">{initials(viewing.profiles)}</span>
        )}
        <div>
          <div className="tw-text-[17px] tw-font-bold">{displayName(viewing.profiles)}</div>
          <div className="tw-text-[13px] tw-text-ink-3 tw-capitalize">{viewing.role}</div>
        </div>
      </div>

      {viewing.profiles?.email ? (
        <div className="tw-mb-4">
          <label className="tw-block tw-text-xs tw-text-ink-3 tw-mb-1.5">{"Email"}</label>
          <div className="tw-text-[13.5px] tw-text-ink-2">{viewing.profiles.email}</div>
        </div>
      ) : null}

      {/* The Organisation section — a Manager card, then a row of every
          direct report, exactly the layout a Teams profile card uses.
          Clicking anyone here just re-points this same card at them; the
          whole reporting chain, all the way up to whoever has nobody
          above them, is walked one click at a time without ever leaving
          this modal. */}
      <div className="tw-mb-4">
        <label className="tw-block tw-text-xs tw-text-ink-3 tw-mb-1.5">{"Organisation"}</label>
        <div className="tw-flex tw-flex-col tw-gap-4">
          <div>
            <div className="tw-text-xs tw-text-ink-3 tw-mb-2">{"Manager"}</div>
            {manager ? (
              <PersonCard person={manager} onClick={() => setViewing(manager)} />
            ) : (
              <div className="tw-text-[13.5px] tw-text-ink-2">{"Not set"}</div>
            )}
          </div>
          {reports.length > 0 ? (
            <div>
              <div className="tw-text-xs tw-text-ink-3 tw-mb-2">{`People reporting to ${displayName(viewing.profiles)} (${reports.length})`}</div>
              <div className="tw-flex tw-gap-3.5 tw-overflow-x-auto tw-pb-0.5">
                {reports.map((r) => (
                  <PersonCard key={r.user_id} person={r} onClick={() => setViewing(r)} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* The "who's the top gun" answer — nobody has to click through the
          whole chain by hand to find out; it's already known from the
          same data, so it's surfaced directly. Only shown once there's an
          actual chain to report on — a person with no manager IS the top,
          which the "Manager: Not set" line above already says. */}
      {!isTop && top && top.user_id !== viewing.user_id ? (
        <div className="tw-mb-4">
          <label className="tw-block tw-text-xs tw-text-ink-3 tw-mb-1.5">{"Top of this reporting chain"}</label>
          <PersonCard person={top} onClick={() => setViewing(top)} />
        </div>
      ) : null}
    </Modal>
  );
};

export default PersonModal;
