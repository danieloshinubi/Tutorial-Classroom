import React, { Suspense } from "react";
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
import { ConfirmProvider } from "./Components/Confirm";
import { startTableWrapFit } from "./lib/tableWrapFit";
import ConfigNotice from "./Components/ConfigNotice";
import { AppLoading } from "./Components/UI";
import { lazyPage } from "./lib/lazyPage";
import ProtectedRoute from "./Components/ProtectedRoute";
import SchoolRoute from "./Components/SchoolRoute";
import Login from "./Pages/Login/Login";
import TenantGate from "./Components/TenantGate";
import { NavDataProvider } from "./context/NavDataContext";
import ComposeAssist from "./Components/ComposeAssist";
import { PresenceProvider } from "./context/PresenceContext";
import TrialGate from "./Components/TrialGate";
import { isPlatformHost, isMarketingHost } from "./lib/tenant";
import "typeface-poppins";
import "./styles/theme.css";
// Loaded after theme.css on purpose — Tailwind utilities and theme.css's
// own single-class rules have equal specificity, so this load order lets a
// converted element's utility classes win over any not-yet-deleted
// theme.css rule during the incremental migration (see the Chat module's
// own migration plan).
import "./styles/tailwind.css";

// Screens load on demand (lazyPage); see the Suspense around <Routes>.
import RouteLoading, { PagePreloader } from "./Components/RouteLoading";

const ApplicantLogin = lazyPage(() => import("./Pages/Login/ApplicantLogin"));
const Signup = lazyPage(() => import("./Pages/Signup/Signup"));
const SignupTutor = lazyPage(() => import("./Pages/Signup/SignupTutor"));
const ForgotPassword = lazyPage(() => import("./Pages/ForgotPassword/ForgotPassword"));
const ResetPassword = lazyPage(() => import("./Pages/ForgotPassword/ResetPassword"));
const SetPassword = lazyPage(() => import("./Pages/ForgotPassword/SetPassword"));
const Dashboard = lazyPage(() => import("./Pages/Dashboard/Dashboard"));
const Courses = lazyPage(() => import("./Pages/Courses/Courses"));
const Apply = lazyPage(() => import("./Pages/Admissions/Apply"));
const ApplyAccount = lazyPage(() => import("./Pages/Admissions/ApplyAccount"));
const ApplyClaim = lazyPage(() => import("./Pages/Admissions/ApplyClaim"));
const ApplicationStatus = lazyPage(() => import("./Pages/Admissions/ApplicationStatus"));
const Applications = lazyPage(() => import("./Pages/Admissions/Applications"));
const ApplyStart = lazyPage(() => import("./Pages/Admissions/ApplyStart"));
const ApplicationDashboard = lazyPage(() => import("./Pages/Admissions/ApplicationDashboard"));
const AdmissionsQueues = lazyPage(() => import("./Pages/Admissions/AdmissionsQueues"));
const AdmissionsWorkspace = lazyPage(() => import("./Pages/Admissions/AdmissionsWorkspace"));
const CourseDashboard = lazyPage(() => import("./Components/Sections/CourseDashboard"));
const AssignmentDetail = lazyPage(() => import("./Pages/Assignments/AssignmentDetail"));
const ExamBuilder = lazyPage(() => import("./Pages/Exams/ExamBuilder"));
const TakeExam = lazyPage(() => import("./Pages/Exams/TakeExam"));
const ExamResults = lazyPage(() => import("./Pages/Exams/ExamResults"));
const Tutors = lazyPage(() => import("./Pages/Tutors/Tutors"));
const Profile = lazyPage(() => import("./Pages/Profile/Profile"));
const Teach = lazyPage(() => import("./Pages/Teach/Teach"));
const CourseForm = lazyPage(() => import("./Pages/Teach/CourseForm"));
const SchoolAdmin = lazyPage(() => import("./Pages/SchoolAdmin/SchoolAdmin"));
const AuditLog = lazyPage(() => import("./Pages/AuditLog/AuditLog"));
const TicketsList = lazyPage(() => import("./Pages/Tickets/TicketsList"));
const TicketDetail = lazyPage(() => import("./Pages/Tickets/TicketDetail"));
const MyTickets = lazyPage(() => import("./Pages/Support/MyTickets"));
const MyTicketDetail = lazyPage(() => import("./Pages/Support/MyTicketDetail"));
const ChatPage = lazyPage(() => import("./Pages/Chat/ChatPage"));
const PlatformApp = lazyPage(() => import("./platform/PlatformApp"));
const MarketingApp = lazyPage(() => import("./marketing/MarketingApp"));
const News = lazyPage(() => import("./Pages/News/News"));
const Bursary = lazyPage(() => import("./Pages/Bursary/Bursary"));
const Store = lazyPage(() => import("./Pages/Store/Store"));
const Accounts = lazyPage(() => import("./Pages/Accounts/Accounts"));
const Payroll = lazyPage(() => import("./Pages/Payroll/Payroll"));
const MyPayslips = lazyPage(() => import("./Pages/Payroll/MyPayslips"));
const Attendance = lazyPage(() => import("./Pages/Attendance/Attendance"));
const Timetable = lazyPage(() => import("./Pages/Timetable/Timetable"));
const Fees = lazyPage(() => import("./Pages/Fees/Fees"));
const PaymentReturn = lazyPage(() => import("./Pages/Fees/PaymentReturn"));
const Reports = lazyPage(() => import("./Pages/Reports/Reports"));
const StudentReport = lazyPage(() => import("./Pages/Reports/StudentReport"));

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
  if (isPlatformHost()) return <Suspense fallback={<AppLoading />}><PlatformApp /></Suspense>;

  // schoolivio.com itself (the bare apex, or www) is the public marketing
  // site and self-serve trial signup — also its own application, for the
  // same reason: there is no tenant to resolve here either. /Welcome works
  // on any host too, so this is reachable in local dev without needing a
  // real apex domain.
  if (isMarketingHost() || window.location.pathname.startsWith("/Welcome")) {
    return <Suspense fallback={<AppLoading />}><MarketingApp /></Suspense>;
  }

  return (
    // A school address that names no school is a 404, before any sign-in.
    <TenantGate>
    <ToastProvider>
    {/* Inside ToastProvider so a confirmation can be followed by a toast, and
        outside the router so any page can ask without mounting its own modal. */}
    <ConfirmProvider>
    <Router>
      <AuthProvider>
        <SchoolProvider>
        <NavDataProvider>
        <PresenceProvider>
          <ConfigNotice />
          {/* "Write with AI" on every note and message box (supabase/228). */}
          <ComposeAssist />
          {/* Every module's code, fetched in the background once signed in. */}
          <PagePreloader />
        <TrialGate>
        {/* Each module's code downloads the first time it is opened, so the
            first load carries the sign-in and shell, not every screen. */}
        <Suspense fallback={<RouteLoading />}>
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
          {/* A separate URL from /Login on purpose — always lands on
              /Applications after signing in, no "from" state to quietly
              redirect somewhere else depending on how you arrived. See
              ApplicantLogin.jsx. */}
          <Route path="/Apply/Login" element={<ApplicantLogin />} />
          {/* Links an application submitted through /Apply (no account) to a
              signed-in one — from "Check an application"'s new prompts. */}
          <Route path="/Apply/Claim" element={<ApplyClaim />} />

          {/* Signed in — any role */}
          <Route element={<ProtectedRoute />}>
            <Route path="/Set-Password" element={<SetPassword />} />
            <Route path="/Dashboard" element={<Dashboard />} />
            <Route path="/Profile" element={<Profile />} />
            <Route path="/Payslips" element={<MyPayslips />} />
            {/* The school's noticeboard, and what a family owes. Both are
                scoped in Postgres: a staff notice is not readable by a
                parent, and an invoice is only visible to its own family. */}
            <Route path="/News" element={<News />} />
            {/* The family side of money: parents and pupils only. Staff are
                sent to Bursary; the page itself lists only the caller's own and
                their children's bills (supabase/187) in any case. */}
            <Route element={<SchoolRoute module="fees" instead="bursary" />}>
              <Route path="/Fees" element={<Fees />} />
            </Route>
            {/* Raise your own request and follow it — every signed-in role,
                same reach as News/Fees. RLS scopes it to the caller's own
                tickets; the staff-side queue at /Tickets is separate. */}
            <Route path="/Support" element={<MyTickets />} />
            <Route path="/Support/:ticketId" element={<MyTicketDetail />} />
            {/* Tenant-wide DMs and group channels — every signed-in role,
                same reach as News/Support. RLS scopes each channel to its
                own members. */}
            <Route path="/Chat" element={<ChatPage />} />
            <Route path="/Chat/:channelId" element={<ChatPage />} />
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

            <Route element={<SchoolRoute module="store" />}>
              <Route path="/Store" element={<Store />} />
            </Route>
            {/* The school's books: owner, admin and bursar (modules.js). */}
            <Route element={<SchoolRoute module="payroll" />}>
              <Route path="/Payroll" element={<Payroll />} />
            </Route>
            <Route element={<SchoolRoute module="accounts" />}>
              <Route path="/Accounts" element={<Accounts />} />
            </Route>

            {/* Daily, per-class marks — form/subject teachers and school
                leadership mark; staff broadly and a guardian for their own
                child read (classroom.can_mark_attendance/is_guardian_of). */}
            <Route element={<SchoolRoute module="attendance" />}>
              <Route path="/Attendance" element={<Attendance />} />
            </Route>
            <Route element={<SchoolRoute module="timetable" />}>
              <Route path="/Timetable" element={<Timetable />} />
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
        </Suspense>
        </TrialGate>
        </PresenceProvider>
        </NavDataProvider>
        </SchoolProvider>
      </AuthProvider>
    </Router>
    </ConfirmProvider>
    </ToastProvider>
    </TenantGate>
  );
}

export default App;
