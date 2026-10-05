import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "./Navbar/Navbar";
import { AppLoading, SkeletonText } from "./UI";
import { useAuth } from "../context/AuthContext";
import { useSchoolIfAny } from "../context/SchoolContext";
import { preloadPages } from "../lib/lazyPage";

// What shows while a screen's code is still downloading. Inside the app the
// menu stays where it is, with a placeholder where the page is coming, so
// opening a module on a computer only changes the right-hand side; the whole
// window no longer turns into a spinner. Before sign-in, and on public pages,
// it is the plain loading screen as before.
const PUBLIC = /^\/(Login|Signup|SignupTutor|Forgot-Password|Reset-Password|Apply)(\/|$)/i;

const RouteLoading = () => {
  const { user } = useAuth();
  const school = useSchoolIfAny();
  const location = useLocation();

  if (!user || !school?.membership || PUBLIC.test(location.pathname)) return <AppLoading />;
  return (
    <div className="shell">
      <Navbar />
      <div className="page">
        <div className="page-body route-loading" aria-busy="true">
          <SkeletonText lines={8} />
        </div>
      </div>
    </div>
  );
};

// Once someone is signed in, the rest of the app's screens are fetched in the
// background, so opening a module is instant rather than a loading screen.
export const PagePreloader = () => {
  const { user } = useAuth();
  useEffect(() => {
    if (user) preloadPages();
  }, [user]);
  return null;
};

export default RouteLoading;
