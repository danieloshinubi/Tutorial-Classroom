import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchUpcomingAssignments } from "../../lib/api";
import { Card, Empty, formatDate } from "../UI";
import { useActionFeedback } from "../Toast";

const Upcoming = ({ courseId }) => {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const { error, setError } = useActionFeedback();

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchUpcomingAssignments(courseId)
      .then((data) => {
        if (active) setAssignments(data);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load assignments.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [courseId, setError]);

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>{"Upcoming"}</h3>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && !error && assignments.length === 0 ? (
        <Empty>{"Woohoo, no work due soon!"}</Empty>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, lineHeight: "1.5rem" }}>
        {assignments.map((assignment) => (
          <li key={assignment.id} style={{ marginBottom: "12px" }}>
            <Link to={`/Assignments/${assignment.id}`} style={{ color: "inherit" }}>
              {assignment.title}
            </Link>
            <div style={{ fontSize: "13px", color: "#777" }}>
              {formatDate(assignment.due_at)}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};

export default Upcoming;
