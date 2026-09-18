import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { SchoolProvider } from "./context/SchoolContext";
import { ToastProvider } from "./Components/Toast";
import { startTableWrapFit } from "./lib/tableWrapFit";
import ConfigNotice from "./Components/ConfigNotice";
import ProtectedRoute from "./Components/ProtectedRoute";
import SchoolRoute from "./Components/SchoolRoute";
import Login from "./Pages/Login/Login";
import Signup from "./Pages/Signup/Signup";
import SignupTutor from "./Pages/Signup/SignupTutor";
import ForgotPassword from "./Pages/ForgotPassword/ForgotPassword";
import ResetPassword from "./Pages/ForgotPassword/ResetPassword";
import SetPassword from "./Pages/ForgotPassword/SetPassword";
import Dashboard from "./Pages/Dashboard/Dashboard";
import Courses from "./Pages/Courses/Courses";
import Apply from "./Pages/Admissions/Apply";
import ApplyAccount from "./Pages/Admissions/ApplyAccount";
import ApplyClaim from "./Pages/Admissions/ApplyClaim";
import ApplicationStatus from "./Pages/Admissions/ApplicationStatus";
import Applications from "./Pages/Admissions/Applications";
import ApplyStart from "./Pages/Admissions/ApplyStart";
import ApplicationDashboard from "./Pages/Admissions/ApplicationDashboard";
import AdmissionsQueues from "./Pages/Admissions/AdmissionsQueues";
import AdmissionsWorkspace from "./Pages/Admissions/AdmissionsWorkspace";
import CourseDashboard from "./Components/Sections/CourseDashboard";
import AssignmentDetail from "./Pages/Assignments/AssignmentDetail";
import ExamBuilder from "./Pages/Exams/ExamBuilder";
import TakeExam from "./Pages/Exams/TakeExam";
import ExamResults from "./Pages/Exams/ExamResults";
import Tutors from "./Pages/Tutors/Tutors";
import Profile from "./Pages/Profile/Profile";
import Teach from "./Pages/Teach/Teach";
import CourseForm from "./Pages/Teach/CourseForm";
import SchoolAdmin from "./Pages/SchoolAdmin/SchoolAdmin";
import AuditLog from "./Pages/AuditLog/AuditLog";
import TicketsList from "./Pages/Tickets/TicketsList";
import TicketDetail from "./Pages/Tickets/TicketDetail";
import MyTickets from "./Pages/Support/MyTickets";
import MyTicketDetail from "./Pages/Support/MyTicketDetail";
import PlatformApp from "./platform/PlatformApp";
import MarketingApp from "./marketing/MarketingApp";
import TrialGate from "./Components/TrialGate";
import { isPlatformHost, isMarketingHost } from "./lib/tenant";
import News from "./Pages/News/News";
import Bursary from "./Pages/Bursary/Bursary";
import Attendance from "./Pages/Attendance/Attendance";
import Fees from "./Pages/Fees/Fees";
import PaymentReturn from "./Pages/Fees/PaymentReturn";
import Reports from "./Pages/Reports/Reports";
import StudentReport from "./Pages/Reports/StudentReport";
import "typeface-poppins";
import "./styles/theme.css";

// Module-scope, not inside the App component: it has to run no matter which
// of App/PlatformApp/MarketingApp ends up mounted below, and it watches
// document.body directly rather than a specific React tree, so there is
// nothing gained by tying it to any one component's lifecycle.
startTableWrapFit();

// /Levels/100/Courses/AZ-900 → /Courses/AZ-900, so bookmarks and old
// notification links survive the change.
const LegacyCourseRedirect = () => {
  const { code } = useParams();
  return <Navigate to={`/Courses/${code}`} replace />;
};

// /Admissions/:id → /AdmissionsWorkspace/:id. The legacy admissions pages
// (a barebones list + detail view with no payment, offer or clearance
// visibility) are gone; every bookmark, nav link and the staff notification
// submit_application() still writes to /Admissions/%s lands on the real
// workspace instead of a dead route.
const LegacyApplicationRedirect = () => {
  const { applicationId } = useParams();
  return <Navigate to={`/AdmissionsWorkspace/${applicationId}`} replace />;
};

function App() {
  // admin.schoolivio.com is not a school. It gets its own application, with no
  // SchoolProvider and no tenant to resolve, rather than a page inside
  // whichever tenant the subdomain happened to name.
  if (isPlatformHost()) return <PlatformApp />;

  // schoolivio.com itself (the bare apex, or www) is the public marketing
  // site and self-serve trial signup — also its own application, for the
  // same reason: there is no tenant to resolve here either. /Welcome works
  // on any host too, so this is reachable in local dev without needing a
  // real apex domain.
  if (isMarketingHost() || window.location.pathname.startsWith("/Welcome")) {
    return <MarketingApp />;
  }

  return (
    <ToastProvider>
    <Router>
      <AuthProvider>
        <SchoolProvider>
          <ConfigNotice />
        <TrialGate>
        <Routes>
          <Route path="/" element={<Navigate to="/Dashboard" replace />} />
          <Route path="/Login" element={<Login />} />
          <Route path="/Signup" element={<Signup />} />
          <Route path="/SignupTutor" element={<SignupTutor />} />
          <Route path="/Forgot-Password" element={<ForgotPassword />} />
          <Route path="/Reset-Password" element={<ResetPassword />} />

          {/* Admissions is open to the public — an applicant has no account. */}
          <Route path="/Apply" element={<Apply />} />
          <Route path="/Apply/Status" element={<ApplicationStatus />} />
          {/* The accounted flow's real front door — signs up, then hands
              off to /Apply/Start. Deliberately its own page rather than the
              general /Signup, which has no way to land back here. */}
          <Route path="/Apply/Account" element={<ApplyAccount />} />
          {/* Links an application submitted through /Apply (no account) to a
              signed-in one — from "Check an application"'s new prompts. */}
          <Route path="/Apply/Claim" element={<ApplyClaim />} />

          {/* Signed in — any role */}
          <Route element={<ProtectedRoute />}>
            <Route path="/Set-Password" element={<SetPassword />} />
            <Route path="/Dashboard" element={<Dashboard />} />
            <Route path="/Profile" element={<Profile />} />
            {/* The school's noticeboard, and what a family owes. Both are
                scoped in Postgres: a staff notice is not readable by a
                parent, and an invoice is only visible to its own family. */}
            <Route path="/News" element={<News />} />
            <Route path="/Fees" element={<Fees />} />
            {/* Raise your own request and follow it — every signed-in role,
                same reach as News/Fees. RLS scopes it to the caller's own
                tickets; the staff-side queue at /Tickets is separate. */}
            <Route path="/Support" element={<MyTickets />} />
            <Route path="/Support/:ticketId" element={<MyTicketDetail />} />
            {/* Where the gateway returns a family. It reports the outcome and
                credits nothing — the signed webhook does that. */}
            <Route path="/Fees/Paid" element={<PaymentReturn />} />
            <Route path="/Tutors" element={<Tutors />} />
            <Route path="/Courses" element={<Courses />} />
            <Route path="/Courses/:code" element={<CourseDashboard />} />
            {/* Old level-based links keep working rather than 404ing. */}
            <Route path="/Levels" element={<Navigate to="/Courses" replace />} />
            <Route path="/Levels/:year/Courses" element={<Navigate to="/Courses" replace />} />
            <Route path="/Levels/:year/Courses/:code" element={<LegacyCourseRedirect />} />
            <Route path="/Assignments/:assignmentId" element={<AssignmentDetail />} />
            <Route path="/Exams/:examId" element={<TakeExam />} />
            {/* Who may see which report is decided in Postgres, not here. */}
            {/* The accounted admissions flow — a signed-in applicant sees
                their applications, starts new ones and completes each one
                through its own dashboard. The RLS on applicant_accounts
                and my_applications() scopes everything to the caller. */}
            <Route path="/Applications" element={<Applications />} />
            <Route path="/Apply/Start" element={<ApplyStart />} />
            <Route path="/Applications/:applicationId" element={<ApplicationDashboard />} />

            <Route path="/Reports" element={<Reports />} />
            <Route path="/Reports/:studentId" element={<StudentReport />} />

            {/* Staff who may run a course. Uses the "teach" module, not the
                broader isStaff check — a bursar or admissions officer has no
                reason to be here and never sees it in their own nav either. */}
            <Route element={<SchoolRoute module="teach" />}>
              <Route path="/Teach" element={<Teach />} />
              <Route path="/Teach/New" element={<CourseForm />} />
              <Route path="/Teach/:courseId/Edit" element={<CourseForm />} />
              <Route path="/Courses/:courseId/Exams/New" element={<ExamBuilder />} />
              <Route path="/Exams/:examId/Edit" element={<ExamBuilder />} />
              <Route path="/Exams/:examId/Results" element={<ExamResults />} />
            </Route>

            {/* Admissions — officers as well as administrators. Reads the
                "admissions" module (owner/admin/principal/admissions) so a
                principal, who already sees this in their nav, can actually
                open it — a route guard hand-written separately from the
                module registry had drifted out of sync and forgotten them. */}
            <Route element={<SchoolRoute module="admissions" />}>
              <Route path="/Admissions" element={<Navigate to="/AdmissionsWorkspace" replace />} />
              <Route path="/Admissions/:applicationId" element={<LegacyApplicationRedirect />} />
              <Route path="/AdmissionsWorkspace" element={<AdmissionsQueues />} />
              <Route path="/AdmissionsWorkspace/:applicationId" element={<AdmissionsWorkspace />} />
            </Route>

            {/* The money. Owner, admin and bursar — a principal signs off
                results, not the accounts. */}
            <Route element={<SchoolRoute module="bursary" />}>
              <Route path="/Bursary" element={<Bursary />} />
            </Route>

            {/* Daily, per-class marks — form/subject teachers and school
                leadership mark; staff broadly and a guardian for their own
                child read (classroom.can_mark_attendance/is_guardian_of). */}
            <Route element={<SchoolRoute module="attendance" />}>
              <Route path="/Attendance" element={<Attendance />} />
            </Route>

            {/* School administration */}
            <Route element={<SchoolRoute module="school" />}>
              <Route path="/School" element={<SchoolAdmin />} />
            </Route>

            {/* Every recorded action, for owner/admin only */}
            <Route element={<SchoolRoute module="auditlog" />}>
              <Route path="/AuditLog" element={<AuditLog />} />
            </Route>

            {/* Staff's own operational support queue — every school-running
                role except teacher, who has no reason to be here. */}
            <Route element={<SchoolRoute module="tickets" />}>
              <Route path="/Tickets" element={<TicketsList />} />
              <Route path="/Tickets/:ticketId" element={<TicketDetail />} />
            </Route>

            {/* The platform console used to live here, at /Platform on a
                school's own subdomain. It does not any more: it manages every
                tenant, so it belongs to none of them. It is a separate
                application on admin.schoolivio.com — see PlatformApp. */}
            <Route path="/Platform" element={<Navigate to="/Dashboard" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/Dashboard" replace />} />
        </Routes>
        </TrialGate>
        </SchoolProvider>
      </AuthProvider>
    </Router>
    </ToastProvider>
  );
}

export default App;
