import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./Pages/Login/Login";
import Signup from "./Pages/Signup/Signup";
import SignupTutor from "./Pages/Signup/SignupTutor";
import ForgotPassword from "./Pages/ForgotPassword/ForgotPassword";
import Levels from "./Pages/Levels/Levels";
import HundredLvlCourses from "./Pages/CoursesPerLevel/YearOneCourses/HundredLvlCourses";
import TwoHundredLvlCourses from "./Pages/CoursesPerLevel/YearTwoCourses/TwoHundredLvlCourses";
import ThreeHundredCourses from "./Pages/CoursesPerLevel/YearThreeCourses/ThreeHundredCourses";
import FourHundredLvlCourses from "./Pages/CoursesPerLevel/yearFourCourses/FourHundredLvlCourses";
import CourseDashboard from "./Components/Sections/CourseDashboard";
import "typeface-poppins";


function App() {
  const appStyles = {
    fontFamily: "Poppins,sans-serif",
  };
  return (
    <Router>
      <div className="App" style={appStyles}>
        <Routes>
          <Route path="/" Component={Login} />
          <Route path="/Login" Component={Login} />
          <Route path="/Signup" Component={Signup} />
          <Route path="/SignupTutor" Component={SignupTutor} />
          <Route path="/Forgot-Password" Component={ForgotPassword} />
          <Route path="/Levels" Component={Levels} />
          <Route path="/Levels/100/Courses" element={<HundredLvlCourses />} />
          <Route
            path="/Levels/200/Courses"
            element={<TwoHundredLvlCourses />}
          />
          <Route path="/Levels/300/Courses" element={<ThreeHundredCourses />} />
          <Route
            path="/Levels/400/Courses"
            element={<FourHundredLvlCourses />}
          />
          <Route path="/CourseDashboard" element={<CourseDashboard />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
