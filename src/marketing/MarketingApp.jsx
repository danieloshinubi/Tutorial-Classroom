import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { isMarketingHost } from "../lib/tenant";
import Landing from "./Landing";
import StartTrial from "./StartTrial";
import "typeface-poppins";
import "./marketing.css";

// The public site at schoolivio.com — no SchoolProvider, no tenant, its own
// Router the same way PlatformApp is its own application at
// admin.schoolivio.com. Reachable locally at /Welcome without a real apex
// domain (App.js routes both here) — basename absorbs that prefix so every
// link inside this bundle can stay a plain "/", "/Start-Trial" regardless
// of which host got us here.
const MarketingApp = () => {
  const basename = isMarketingHost() ? undefined : "/Welcome";

  return (
    <Router basename={basename}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/Start-Trial" element={<StartTrial />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
};

export default MarketingApp;
