import React, { useCallback, useEffect, useState } from "react";
import { Card, Button, Notice, Empty, Select, Badge, Field, formatDate, displayName } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { useConfirm, usePrompt } from "../../Components/Confirm";
import { useSchool } from "../../context/SchoolContext";
import {
  decideSchoolAccess,
  endSchoolAccess,
  fetchAccessRequests,
  fetchGrantedMembers,
  type AccessRequest,
  type GrantedMember,
} from "../../lib/schoolAccessApi";

// School admin → Schoolivio access (supabase/224). Schoolivio's own staff
// come into the school only when its owners or admins let them: requests
// wait here to be approved for a set time or declined; whoever is in now
// can be ended early; everything is kept as a history. Break-glass staff
// (for emergencies) come in without asking, and show here too.

const DURATIONS = [
  { value: "1", label: "1 hour" },
  { value: "4", label: "4 hours" },
  { value: "8", label: "8 hours (a working day)" },
  { value: "24", label: "1 day" },
  { value: "72", label: "3 days" },
  { value: "168", label: "1 week" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Withdrawn",
  ended: "Ended",
};
const STATUS_TONE: Record<string, string> = { pending: "warn", approved: "success", declined: "danger", ended: "muted", cancelled: "muted" };

const SchoolAccessPanel = () => {
  const { schoolId } = useSchool();
  const { setError, setNotice } = useActionFeedback();
  const confirmAction = useConfirm();
  const promptFor = usePrompt();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [granted, setGranted] = useState<GrantedMember[]>([]);
  const [hours, setHours] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!schoolId) return;
    try {
      const [r, g] = await Promise.all([fetchAccessRequests(schoolId), fetchGrantedMembers(schoolId)]);
      setRequests(r);
      setGranted(g);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = requests.filter((r) => r.status === "pending");
  const history = requests.filter((r) => r.status !== "pending");

  const approve = async (r: AccessRequest) => {
    const h = Number(hours[r.id] || "4");
    const label = DURATIONS.find((d) => Number(d.value) === h)?.label || `${h} hours`;
    const ok = await confirmAction({
      title: `Let ${r.requester_name} in for ${label}?`,
      body: "They will act as an admin of this school until then, and their access ends by itself. You can end it sooner here.",
      confirmLabel: "Approve",
    });
    if (!ok) return;
    setBusy(r.id);
    try {
      await decideSchoolAccess(r.id, true, h);
      setNotice(`${r.requester_name} can access the school for ${label}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const decline = async (r: AccessRequest) => {
    const note = await promptFor({
      title: `Decline ${r.requester_name}'s request?`,
      body: "They will see that it was declined. You can add a note for them.",
      label: "Note (optional)",
      placeholder: "e.g. Please arrange this with our principal first.",
      confirmLabel: "Decline",
    });
    if (note === null) return;
    setBusy(r.id);
    try {
      await decideSchoolAccess(r.id, false, null, note || undefined);
      setNotice("Request declined.");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const end = async (m: GrantedMember) => {
    const who = displayName(m.profiles);
    const ok = await confirmAction({ title: `End ${who}'s access now?`, body: "They are taken out of the school straight away.", confirmLabel: "End access" });
    if (!ok || !schoolId) return;
    setBusy(m.id);
    try {
      await endSchoolAccess(schoolId, m.user_id);
      setNotice(`${who} no longer has access.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sa-access">
      <Notice tone="muted">
        {"Schoolivio's support staff can only come into your school when you let them, for as long as you choose. They act as an admin while here, everything they do is in the audit log, and their access ends by itself."}
      </Notice>

      <Card>
        <h3 className="sa-access-h">{"Waiting for you"}</h3>
        {loading ? null : pending.length ? (
          <ul className="sa-access-list">
            {pending.map((r) => (
              <li key={r.id} className="sa-access-item">
                <div className="sa-access-who">
                  <strong>{r.requester_name}</strong>
                  <span>{`${r.requester_email || ""} · asked ${formatDate(r.created_at)}`}</span>
                  <p className="sa-access-reason">{r.reason}</p>
                </div>
                <div className="sa-access-decide">
                  <Field label="For how long">
                    <Select value={hours[r.id] || "4"} onChange={(v) => setHours((c) => ({ ...c, [r.id]: v }))} options={DURATIONS} />
                  </Field>
                  <div className="btn-row">
                    <Button size="sm" disabled={busy === r.id} onClick={() => approve(r)}>
                      {"Approve"}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decline(r)}>
                      {"Decline"}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{"No requests waiting."}</Empty>
        )}
      </Card>

      <Card>
        <h3 className="sa-access-h">{"In your school now"}</h3>
        {loading ? null : granted.length ? (
          <ul className="sa-access-list">
            {granted.map((m) => (
              <li key={m.id} className="sa-access-item">
                <div className="sa-access-who">
                  <strong>
                    {displayName(m.profiles)}{" "}
                    {m.granted_via === "platform_breakglass" ? <Badge tone="warn">{"Break-glass"}</Badge> : <Badge>{"Approved"}</Badge>}
                  </strong>
                  <span>{`${m.profiles?.email || ""} · until ${formatDate(m.access_expires_at)}`}</span>
                </div>
                <Button size="sm" variant="danger-outline" disabled={busy === m.id} onClick={() => end(m)}>
                  {"End now"}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{"Nobody from Schoolivio has access right now."}</Empty>
        )}
      </Card>

      {history.length ? (
        <Card className="pad-0">
          <h3 className="sa-access-h" style={{ padding: "16px 18px 0" }}>{"History"}</h3>
          <div className="table-wrap table-wrap-plain">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Who"}</th>
                  <th>{"Reason"}</th>
                  <th>{"Outcome"}</th>
                  <th>{"Decided by"}</th>
                  <th>{"When"}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.requester_name}</strong>
                    </td>
                    <td className="sa-access-reason-cell">{r.reason}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status] || "muted"}>{STATUS_LABEL[r.status] || r.status}</Badge>
                      {r.status === "approved" && r.hours ? <span className="sa-access-sub">{` ${r.hours}h`}</span> : null}
                      {r.decline_note ? <span className="sa-access-sub">{` “${r.decline_note}”`}</span> : null}
                    </td>
                    <td>{r.decided_by_name || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDate(r.decided_at || r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
};

export default SchoolAccessPanel;
