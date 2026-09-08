import React from "react";

// Honest, calm reporting of what the connection is doing. A student mid-exam
// needs to know their work is safe, not to be alarmed.
const STATES = {
  online: null,
  syncing: {
    className: "conn conn-syncing",
    text: "Saving your answers...",
  },
  offline: {
    className: "conn conn-offline",
    text:
      "You are offline. Your answers are saved on this device and will send automatically when the connection returns.",
  },
  slow: {
    className: "conn conn-slow",
    text: "Connection is slow. Your answers are saved on this device.",
  },
};

const ConnectionStatus = ({ state, pending }) => {
  const config = STATES[state];
  if (!config) return null;

  return (
    <div className={config.className} role="status" aria-live="polite">
      <span className="conn-dot" />
      <span>
        {config.text}
        {pending > 0 ? ` (${pending} unsent)` : ""}
      </span>
    </div>
  );
};

export default ConnectionStatus;
