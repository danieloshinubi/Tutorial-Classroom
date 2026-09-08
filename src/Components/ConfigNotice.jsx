import React, { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

const noticeStyle = {
  background: "#7a1f1f",
  color: "white",
  padding: "12px 16px",
  fontSize: "14px",
  lineHeight: "1.6",
  textAlign: "center",
};

const codeStyle = {
  background: "rgb(255 255 255 / 0.15)",
  padding: "1px 5px",
  borderRadius: "4px",
};

// Two setup steps are easy to miss and produce confusing failures deeper in the
// app: missing env vars, and a `classroom` schema that exists but has not been
// exposed to the API. Probe for both once and say plainly which one is wrong.
const ConfigNotice = () => {
  const [schemaProblem, setSchemaProblem] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;

    supabase
      .from("levels")
      .select("year")
      .limit(1)
      .then(({ error }) => {
        if (!active || !error) return;
        if (error.code === "PGRST106") {
          setSchemaProblem("not-exposed");
        } else if (error.code === "42P01") {
          setSchemaProblem("missing");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div style={noticeStyle}>
        {"Supabase is not configured. Create a "}
        <code style={codeStyle}>{".env"}</code>
        {" file with "}
        <code style={codeStyle}>{"REACT_APP_SUPABASE_URL"}</code>
        {" and "}
        <code style={codeStyle}>{"REACT_APP_SUPABASE_ANON_KEY"}</code>
        {", then restart the dev server. See "}
        <code style={codeStyle}>{".env.example"}</code>
        {"."}
      </div>
    );
  }

  if (schemaProblem === "not-exposed") {
    return (
      <div style={noticeStyle}>
        {"The database is reachable, but the "}
        <code style={codeStyle}>{"classroom"}</code>
        {" schema is not exposed to the API. In Supabase go to "}
        <strong>{"Settings → Data API → Exposed schemas"}</strong>
        {" and add "}
        <code style={codeStyle}>{"classroom"}</code>
        {"."}
      </div>
    );
  }

  if (schemaProblem === "missing") {
    return (
      <div style={noticeStyle}>
        {"The "}
        <code style={codeStyle}>{"classroom"}</code>
        {" tables do not exist yet. Open the Supabase SQL Editor and run "}
        <code style={codeStyle}>{"supabase/schema.sql"}</code>
        {"."}
      </div>
    );
  }

  return null;
};

export default ConfigNotice;
