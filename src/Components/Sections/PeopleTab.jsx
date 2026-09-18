import React, { useCallback, useEffect, useState } from "react";
import { useActionFeedback } from "../Toast";
import {
  fetchParticipants,
  decideEnrollment,
  removeParticipant,
} from "../../lib/api";
import {
  Card,
  Badge,
  Button,
  Empty,
  displayName,
  initials,
  formatDate,
} from "../UI";

const Person = ({ profile, children, sub }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
    {profile.avatar_url ? (
      <img
        src={profile.avatar_url}
        alt=""
        style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }}
      />
    ) : (
      <span className="brand-mark" style={{ width: 38, height: 38, borderRadius: "50%" }}>
        {initials(profile)}
      </span>
    )}
    <div style={{ flex: 1, minWidth: 160 }}>
      <div style={{ fontWeight: 550 }}>{displayName(profile)}</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{sub}</div>
    </div>
    {children}
  </div>
);

const PeopleTab = ({ course, canManage, schoolId }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const { setError } = useActionFeedback();

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    fetchParticipants({ courseId: course.id, schoolId })
      .then(setRows)
      .catch((err) => setError(err.message || "Could not load participants."))
      .finally(() => setLoading(false));
  }, [course.id, schoolId, setError]);

  useEffect(load, [load]);

  const decide = async (userId, approve) => {
    setBusyId(userId);
    setError("");
    try {
      await decideEnrollment({ courseId: course.id, userId, approve });
      load();
    } catch (err) {
      setError(err.message || "Could not update that request.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (profile) => {
    if (!window.confirm(`Remove ${displayName(profile)} from ${course.code}?`)) return;
    setBusyId(profile.id);
    setError("");
    try {
      await removeParticipant({ courseId: course.id, userId: profile.id });
      load();
    } catch (err) {
      setError(err.message || "Could not remove that participant.");
    } finally {
      setBusyId(null);
    }
  };

  const pending = rows.filter((row) => row.status === "pending");
  const approved = rows.filter((row) => row.status === "approved");
  const declined = rows.filter((row) => row.status === "declined");

  return (
    <>

      <h3>{"Tutor"}</h3>
      <Card style={{ marginBottom: 26 }}>
        {course.owner ? (
          <Person profile={course.owner} sub={course.owner.email || ""}>
            <Badge tone={course.owner.role === "admin" ? "danger" : "brand"}>
              {course.owner.role}
            </Badge>
          </Person>
        ) : (
          <span style={{ color: "var(--ink-3)" }}>
            {"This is a catalogue course with no tutor assigned yet."}
          </span>
        )}
      </Card>

      {/* Requests come first — this is the queue a tutor needs to act on. */}
      {canManage ? (
        <>
          <h3>
            {"Requests to join"}
            {pending.length > 0 ? (
              <span style={{ marginLeft: 8 }}>
                <Badge tone="warn">{pending.length}</Badge>
              </span>
            ) : null}
          </h3>
          {loading ? <Empty>{"Loading..."}</Empty> : null}
          {!loading && pending.length === 0 ? (
            <Empty>{"No one is waiting for approval."}</Empty>
          ) : null}

          {pending.map((row) => (
            <Card key={row.profiles.id} style={{ marginBottom: 10 }}>
              <Person
                profile={row.profiles}
                sub={`Asked ${formatDate(row.requested_at)}`}
              >
                <span className="btn-row">
                  <Button
                    size="sm"
                    disabled={busyId === row.profiles.id}
                    onClick={() => decide(row.profiles.id, true)}
                  >
                    {"Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === row.profiles.id}
                    onClick={() => decide(row.profiles.id, false)}
                  >
                    {"Decline"}
                  </Button>
                </span>
              </Person>
              {row.message ? (
                <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--ink-2)" }}>
                  {row.message}
                </p>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      <h3 style={{ marginTop: 26 }}>
        {"Participants"}
        <span style={{ marginLeft: 8 }}>
          <Badge>{approved.length}</Badge>
        </span>
      </h3>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {/* Row level security only returns the full roster to the course's own
          tutor or an admin, so explain an empty list rather than implying
          nobody has joined. */}
      {!loading && approved.length === 0 ? (
        <Empty>
          {canManage
            ? "Nobody has joined this course yet."
            : "Only the course tutor can see the full class list."}
        </Empty>
      ) : null}

      {approved.map((row) => (
        <Card key={row.profiles.id} style={{ marginBottom: 10 }}>
          <Person
            profile={row.profiles}
            sub={row.decided_at ? `Joined ${formatDate(row.decided_at, { withTime: false })}` : ""}
          >
            {canManage ? (
              <Button
                size="sm"
                variant="danger"
                disabled={busyId === row.profiles.id}
                onClick={() => remove(row.profiles)}
              >
                {"Remove"}
              </Button>
            ) : null}
          </Person>
        </Card>
      ))}

      {canManage && declined.length > 0 ? (
        <>
          <h3 style={{ marginTop: 26 }}>{"Declined"}</h3>
          {declined.map((row) => (
            <Card key={row.profiles.id} style={{ marginBottom: 10 }}>
              <Person profile={row.profiles} sub={formatDate(row.decided_at)}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === row.profiles.id}
                  onClick={() => decide(row.profiles.id, true)}
                >
                  {"Approve after all"}
                </Button>
              </Person>
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
};

export default PeopleTab;
