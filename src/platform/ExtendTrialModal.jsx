import React, { useState } from "react";
import { extendTrial } from "../lib/platformApi";
import { Modal, Field, Button, formatDate } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";

// Shared by Overview's "Trials expiring soon" card, the Trials list page and
// a school's own detail page — one place for what "extend a trial" means so
// the three don't drift.
const ExtendTrialModal = ({ school, onClose, onDone }) => {
  const [days, setDays] = useState("45");
  const [busy, setBusy] = useState(false);
  const { setError } = useActionFeedback();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await extendTrial({ schoolId: school.id, days: Number(days) });
      onDone(updated, `${school.name}'s trial now runs ${days} more days.`);
    } catch (err) {
      setError(err.message || "Could not extend that trial.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Extend ${school.name}'s trial`}
      subtitle={
        school.trial_ends_at
          ? `Currently ${new Date(school.trial_ends_at) < new Date() ? "expired" : "ends"} ${formatDate(school.trial_ends_at, { withTime: false })}.`
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{"Cancel"}</Button>
          <Button type="submit" form="extend-trial-form" disabled={busy}>
            {busy ? "Extending..." : "Extend"}
          </Button>
        </>
      }
    >
      <form id="extend-trial-form" onSubmit={submit}>
        <Field label="Extra days" hint="Counted from today, or from the current expiry if it's later than today.">
          <input
            type="number"
            min="1"
            className="input"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
};

export default ExtendTrialModal;
