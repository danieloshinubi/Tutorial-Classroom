import React from "react";
import { Link } from "react-router-dom";
import SignupForm from "./SignupForm";

const Signup = () => (
  <SignupForm
    heading="Sign Up"
    subheading="Create a New Account"
    role="student"
    footer={
      <p>
        {"Sign Up as Tutor? "}
        <span>
          <Link to="/SignupTutor">{"Sign Up"}</Link>
        </span>
      </p>
    }
  />
);

export default Signup;
