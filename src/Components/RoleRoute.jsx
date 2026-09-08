import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Gate for the tutor and admin areas. This is a convenience for the UI only —
// the real enforcement is row level security in Postgres, so a user who forces
// their way to one of these URLs still cannot read or write anything.
const RoleRoute = ({ allow }) => {
  const { profile, loading } = useAuth();

  if (loading) {
    return <p style={{ textAlign: "center", marginTop: "15%" }}>{"Loading..."}</p>;
  }

  if (!profile || !allow.includes(profile.role)) {
    return <Navigate to="/Dashboard" replace />;
  }

  return <Outlet />;
};

export default RoleRoute;
