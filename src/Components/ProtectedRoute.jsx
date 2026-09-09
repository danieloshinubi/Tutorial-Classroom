import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ProtectedRoute = () => {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p style={{ textAlign: "center", marginTop: "20%" }}>{"Loading..."}</p>;
  }

  if (!session) {
    return <Navigate to="/Login" replace state={{ from: location }} />;
  }

  // Signed in on a password an administrator issued. Nothing else opens until
  // it has been replaced.
  if (profile?.must_change_password && location.pathname !== "/Set-Password") {
    return <Navigate to="/Set-Password" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
