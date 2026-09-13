import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Mark } from "./Logo";

// A minimal header for the accounted-applicant flow — deliberately NOT the
// tenant Navbar. An applicant has no school_members row, so the
// staff/student sidebar (search, courses, bursary, audit log...) has
// nothing for them and showing it invites confusion, not access. This is
// the whole "shell" that page needs: who they're applying to, a way back
// to their application list, and a way to sign out.
export const ApplicantShell = ({ school }) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/Login", { replace: true });
  };

  return (
    <header className="applicant-shell">
      <div className="applicant-shell-inner">
        <Link to="/Applications" className="applicant-shell-brand">
          {school?.logo_url ? (
            <img src={school.logo_url} alt="" />
          ) : (
            <Mark size={26} />
          )}
          <span>{school?.name || "Schoolivio"}</span>
        </Link>
        <nav className="applicant-shell-nav">
          <Link to="/Applications">{"My applications"}</Link>
        </nav>
        <span className="applicant-shell-spacer" />
        <span className="applicant-shell-user">
          {user?.email}
          <button type="button" className="applicant-shell-signout" onClick={handleSignOut}>
            {"Sign out"}
          </button>
        </span>
      </div>
    </header>
  );
};

export default ApplicantShell;
