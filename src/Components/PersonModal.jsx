import React, { useEffect, useState } from "react";
import { Modal, displayName, initials } from "./UI";
import { findTopOfChain } from "../lib/orgChart";

// One card in the Organisation section — a photo (or initials) above a
// name and role, the same "Manager" / "People reporting to X" layout
// Teams' own profile card uses. Clicking any card re-points the SAME
// modal at that person (Teams' own click-through) — there is no page to
// navigate to here; the whole chain is walked inside this one card.
const PersonCard = ({ person, onClick }) => (
  <button type="button" className="person-org-card" onClick={onClick}>
    {person.profiles?.avatar_url ? (
      <img src={person.profiles.avatar_url} alt="" className="tix-avatar person-org-avatar person-org-avatar-photo" />
    ) : (
      <span className="tix-avatar person-org-avatar">{initials(person.profiles)}</span>
    )}
    <span className="person-org-card-name">{displayName(person.profiles)}</span>
    <span className="person-org-card-role">{person.role}</span>
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
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        {viewing.profiles?.avatar_url ? (
          <img
            src={viewing.profiles.avatar_url}
            alt=""
            className="tix-avatar person-modal-avatar-photo"
            style={{ width: 52, height: 52 }}
          />
        ) : (
          <span className="tix-avatar" style={{ width: 52, height: 52, fontSize: 18 }}>
            {initials(viewing.profiles)}
          </span>
        )}
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{displayName(viewing.profiles)}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", textTransform: "capitalize" }}>{viewing.role}</div>
        </div>
      </div>

      {viewing.profiles?.email ? (
        <div className="person-field">
          <label>{"Email"}</label>
          <div className="person-field-value">{viewing.profiles.email}</div>
        </div>
      ) : null}

      {/* The Organisation section — a Manager card, then a row of every
          direct report, exactly the layout a Teams profile card uses.
          Clicking anyone here just re-points this same card at them; the
          whole reporting chain, all the way up to whoever has nobody
          above them, is walked one click at a time without ever leaving
          this modal. */}
      <div className="person-field">
        <label>{"Organisation"}</label>
        <div className="person-org-groups">
          <div className="person-org-group">
            <div className="person-org-group-label">{"Manager"}</div>
            {manager ? (
              <PersonCard person={manager} onClick={() => setViewing(manager)} />
            ) : (
              <div className="person-field-value">{"Not set"}</div>
            )}
          </div>
          {reports.length > 0 ? (
            <div className="person-org-group">
              <div className="person-org-group-label">{`People reporting to ${displayName(viewing.profiles)} (${reports.length})`}</div>
              <div className="person-org-row">
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
        <div className="person-field">
          <label>{"Top of this reporting chain"}</label>
          <PersonCard person={top} onClick={() => setViewing(top)} />
        </div>
      ) : null}
    </Modal>
  );
};

export default PersonModal;
