import React, { useEffect, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { fetchTutors } from "../../lib/api";
import {
  Page,
  Card,
  Grid,
  Badge,
  Empty,
  Notice,
  displayName,
} from "../../Components/UI";

const Tutors = () => {
  const [tutors, setTutors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    fetchTutors()
      .then((data) => {
        if (active) setTutors(data);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load the tutors.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <Navbar />
      <Page title="Tutors">
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading tutors..."}</Empty> : null}
        {!loading && !error && tutors.length === 0 ? (
          <Empty>{"No tutors have signed up yet."}</Empty>
        ) : null}

        <Grid>
          {tutors.map((tutor) => (
            <Card key={tutor.id}>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <img
                  src={tutor.avatar_url || "/images/final.jpg"}
                  alt=""
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "30px",
                    objectFit: "cover",
                  }}
                />
                <div>
                  <strong>{displayName(tutor)}</strong>
                  <div style={{ marginTop: "4px" }}>
                    <Badge tone={tutor.role === "admin" ? "admin" : "tutor"}>
                      {tutor.role}
                    </Badge>
                  </div>
                </div>
              </div>
              {tutor.bio ? (
                <p style={{ marginBottom: 0, color: "#555" }}>{tutor.bio}</p>
              ) : null}
            </Card>
          ))}
        </Grid>
      </Page>
    </>
  );
};

export default Tutors;
