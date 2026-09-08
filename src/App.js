import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ConfigNotice from "./Components/ConfigNotice";
import ProtectedRoute from "./Components/ProtectedRoute";
import RoleRoute from "./Components/RoleRoute";
import Login from "./Pages/Login/Login";
import Signup from "./Pages/Signup/Signup";
import SignupTutor from "./Pages/Signup/SignupTutor";
import ForgotPassword from "./Pages/ForgotPassword/ForgotPassword";
import ResetPassword from "./Pages/ForgotPassword/ResetPassword";
import Dashboard from "./Pages/Dashboard/Dashboard";
import Levels from "./Pages/Levels/Levels";
import LevelCourses from "./Pages/CoursesPerLevel/LevelCourses";
import CourseDashboard from "./Components/Sections/CourseDashboard";
import AssignmentDetail from "./Pages/Assignments/AssignmentDetail";
import ExamBuilder from "./Pages/Exams/ExamBuilder";
import TakeExam from "./Pages/Exams/TakeExam";
import ExamResults from "./Pages/Exams/ExamResults";
import Tutors from "./Pages/Tutors/Tutors";
import Profile from "./Pages/Profile/Profile";
import Teach from "./Pages/Teach/Teach";
import CourseForm from "./Pages/Teach/CourseForm";
import Admin from "./Pages/Admin/Admin";
import "typeface-poppins";
import "./styles/theme.css";

function App() {
  return (
    <Router>
      <AuthProvider>
        <ConfigNotice />
        <Routes>
          <Route path="/" element={<Navigate to="/Dashboard" replace />} />
          <Route path="/Login" element={<Login />} />
          <Route path="/Signup" element={<Signup />} />
          <Route path="/SignupTutor" element={<SignupTutor />} />
          <Route path="/Forgot-Password" element={<ForgotPassword />} />
          <Route path="/Reset-Password" element={<ResetPassword />} />

          {/* Signed in — any role */}
          <Route element={<ProtectedRoute />}>
            <Route path="/Dashboard" element={<Dashboard />} />
            <Route path="/Profile" element={<Profile />} />
            <Route path="/Tutors" element={<Tutors />} />
            <Route path="/Levels" element={<Levels />} />
            <Route path="/Levels/:year/Courses" element={<LevelCourses />} />
            <Route path="/Levels/:year/Courses/:code" element={<CourseDashboard />} />
            <Route path="/Assignments/:assignmentId" element={<AssignmentDetail />} />
            <Route path="/Exams/:examId" element={<TakeExam />} />

            {/* Tutors and admins */}
            <Route element={<RoleRoute allow={["tutor", "admin"]} />}>
              <Route path="/Teach" element={<Teach />} />
              <Route path="/Teach/New" element={<CourseForm />} />
              <Route path="/Teach/:courseId/Edit" element={<CourseForm />} />
              <Route path="/Courses/:courseId/Exams/New" element={<ExamBuilder />} />
              <Route path="/Exams/:examId/Edit" element={<ExamBuilder />} />
              <Route path="/Exams/:examId/Results" element={<ExamResults />} />
            </Route>

            {/* Admins only */}
            <Route element={<RoleRoute allow={["admin"]} />}>
              <Route path="/Admin" element={<Admin />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/Dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
