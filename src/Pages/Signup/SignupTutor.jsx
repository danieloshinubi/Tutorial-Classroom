import React from "react";
import { Link } from "react-router-dom";
import SignupForm from "./SignupForm";

const SignupTutor = () => (
  <SignupForm
    heading="Sign Up as Tutor"
    subheading="Create a New Tutor Account"
    role="tutor"
    footer={
      <p>
        {"Sign Up as Student? "}
        <span>
          <Link to="/Signup">{"Sign Up"}</Link>
        </span>
      </p>
    }
  />
);

export default SignupTutor;
