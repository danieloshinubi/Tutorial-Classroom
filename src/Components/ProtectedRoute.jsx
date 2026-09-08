import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ProtectedRoute = () => {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p style={{ textAlign: "center", marginTop: "20%" }}>{"Loading..."}</p>;
  }

  if (!session) {
    return <Navigate to="/Login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
