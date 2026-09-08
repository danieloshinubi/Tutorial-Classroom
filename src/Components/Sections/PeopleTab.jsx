import React, { useEffect, useState } from "react";
import { fetchRoster } from "../../lib/api";
import { Card, Badge, Notice, Empty, displayName } from "../UI";

const PeopleTab = ({ course, canManage }) => {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchRoster(course.id)
      .then((data) => {
        if (active) setRoster(data);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load the roster.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [course.id]);

  return (
    <>
      <h3 style={{ marginTop: 0 }}>{"Tutor"}</h3>
      <Card style={{ marginBottom: "22px" }}>
        {course.owner ? (
          <span style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <strong>{displayName(course.owner)}</strong>
            <Badge tone={course.owner.role === "admin" ? "admin" : "tutor"}>
              {course.owner.role}
            </Badge>
          </span>
        ) : (
          <span style={{ color: "#666" }}>
            {"This is a catalogue course with no tutor assigned yet."}
          </span>
        )}
      </Card>

      <h3>{"Students"}</h3>
      <Notice tone="error">{error}</Notice>
      {loading ? <Empty>{"Loading..."}</Empty> : null}

      {/* Row level security only returns the full roster to the course's own
          tutor or an admin, so explain the empty list rather than implying
          nobody has joined. */}
      {!loading && !error && roster.length === 0 ? (
        <Empty>
          {canManage
            ? "Nobody has joined this course yet."
            : "Only the course tutor can see the full class list."}
        </Empty>
      ) : null}

      {roster.map((student) => (
        <Card key={student.id} style={{ marginBottom: "10px" }}>
          <span style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <img
              src={student.avatar_url || "/images/final.jpg"}
              alt=""
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "30px",
                objectFit: "cover",
              }}
            />
            <span>{displayName(student)}</span>
          </span>
        </Card>
      ))}
    </>
  );
};

export default PeopleTab;
