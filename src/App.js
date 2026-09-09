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
import ApplicationStatus from "./Pages/Admissions/ApplicationStatus";
import Admissions from "./Pages/Admissions/Admissions";
import ApplicationDetail from "./Pages/Admissions/ApplicationDetail";
import CourseDashboard from "./Components/Sections/CourseDashboard";
import AssignmentDetail from "./Pages/Assignments/AssignmentDetail";
import ExamBuilder from "./Pages/Exams/ExamBuilder";
import TakeExam from "./Pages/Exams/TakeExam";
import ExamResults from "./Pages/Exams/ExamResults";
import Tutors from "./Pages/Tutors/Tutors";
import Profile from "./Pages/Profile/Profile";
import Teach from "./Pages/Teach/Teach";
import CourseForm from "./Pages/Teach/CourseForm";
import Platform from "./Pages/Platform/Platform";
import SchoolAdmin from "./Pages/SchoolAdmin/SchoolAdmin";
import Reports from "./Pages/Reports/Reports";
import StudentReport from "./Pages/Reports/StudentReport";
import "typeface-poppins";
import "./styles/theme.css";

// /Levels/100/Courses/AZ-900 → /Courses/AZ-900, so bookmarks and old
// notification links survive the change.
const LegacyCourseRedirect = () => {
  const { code } = useParams();
  return <Navigate to={`/Courses/${code}`} replace />;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <SchoolProvider>
          <ConfigNotice />
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

          {/* Signed in — any role */}
          <Route element={<ProtectedRoute />}>
            <Route path="/Set-Password" element={<SetPassword />} />
            <Route path="/Dashboard" element={<Dashboard />} />
            <Route path="/Profile" element={<Profile />} />
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
            <Route path="/Reports" element={<Reports />} />
            <Route path="/Reports/:studentId" element={<StudentReport />} />

            {/* Staff who may run a course */}
            <Route element={<SchoolRoute require="staff" />}>
              <Route path="/Teach" element={<Teach />} />
              <Route path="/Teach/New" element={<CourseForm />} />
              <Route path="/Teach/:courseId/Edit" element={<CourseForm />} />
              <Route path="/Courses/:courseId/Exams/New" element={<ExamBuilder />} />
              <Route path="/Exams/:examId/Edit" element={<ExamBuilder />} />
              <Route path="/Exams/:examId/Results" element={<ExamResults />} />
            </Route>

            {/* Admissions — officers as well as administrators */}
            <Route element={<SchoolRoute require="admissions" />}>
              <Route path="/Admissions" element={<Admissions />} />
              <Route path="/Admissions/:applicationId" element={<ApplicationDetail />} />
            </Route>

            {/* School administration */}
            <Route element={<SchoolRoute require="admin" />}>
              <Route path="/School" element={<SchoolAdmin />} />
            </Route>

            {/* The vendor's own console, across every school */}
            <Route element={<SchoolRoute require="platform" />}>
              <Route path="/Platform" element={<Platform />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/Dashboard" replace />} />
        </Routes>
        </SchoolProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
