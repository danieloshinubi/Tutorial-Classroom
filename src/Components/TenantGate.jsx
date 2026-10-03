import React, { useEffect, useState } from "react";
import { slugFromHost } from "../lib/tenant";
import { cachedPublicSchool, rememberPublicSchool, revealPage } from "../lib/branding";
import { AppLoading } from "./UI";
import { Mark } from "./Logo";
import { fetchPublicSchool } from "../lib/publicSchool";

// An address that names no school is a 404, not a sign-in page.
//
// charismartin-int.schoolivio.com (one letter short) used to open a generic
// Schoolivio sign-in, as if a school were there. Every school address is now
// confirmed first (public_school, which also answers before sign-in). A
// school this device has opened before shows at once while it is re-checked.
// A failed lookup (no network) does not lock anyone out; only a definite "no
// such school" shows the 404.
const TenantGate = ({ children }) => {
  const slug = slugFromHost();
  const [state, setState] = useState(() => {
    if (!slug) return "ok";
    return cachedPublicSchool(slug) ? "ok" : "checking";
  });

  useEffect(() => {
    if (!slug) return undefined;
    let alive = true;
    fetchPublicSchool(slug)
      .then(({ data, error }) => {
        if (!alive || error) {
          if (alive) setState("ok");
          return;
        }
        if (data?.length) {
          rememberPublicSchool(data[0]);
          setState("ok");
        } else {
          revealPage();
          setState("missing");
        }
      })
      .catch(() => alive && setState("ok"));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (state === "checking") return <AppLoading label="Loading..." />;
  if (state === "missing") return <NoSuchSchool slug={slug} />;
  return children;
};

const NoSuchSchool = ({ slug }) => {
  const { protocol, hostname, port } = window.location;
  const parts = hostname.toLowerCase().split(".");
  const base = hostname.endsWith("localhost") ? "localhost" : parts.slice(-2).join(".");
  const home = hostname.endsWith("localhost")
    ? `${protocol}//localhost${port ? `:${port}` : ""}/Welcome`
    : `${protocol}//${base}`;

  useEffect(() => {
    document.title = "School not found · Schoolivio";
  }, []);

  return (
    <main className="nf-page">
      <div className="nf-card" role="alert">
        <a className="nf-brand" href={home}><Mark size={24} />{"Schoolivio"}</a>
        <p className="nf-code">{"404"}</p>
        <h1>{"There's no school at this address"}</h1>
        <p className="nf-address">{`${slug}.${base}`}</p>
        <p className="nf-body">
          {"Check the address your school gave you; a single letter out is enough to miss it. If you are sure it is right, ask your school for the link."}
        </p>
        <a className="nf-link" href={home}>{"Go to Schoolivio"}</a>
      </div>
    </main>
  );
};

export default TenantGate;
