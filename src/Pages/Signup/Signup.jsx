import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { eyeOff } from "react-icons-kit/feather/eyeOff";
import { eye } from "react-icons-kit/feather/eye";
import { SignupStyle } from "./SignupStyle";

const Signup = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  const passwordImage = "/images/password.png";
  const usernameImage = "/images/username.png";

  const togglePasswordVisibility = () => {
    setPasswordVisible(!passwordVisible);
  };

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  if (windowWidth >= 320 && windowWidth <= 480) {
    SignupStyle.width = "90%";
    SignupStyle.marginTop = "15%";
    SignupStyle.height = "auto";
    SignupStyle.formStyle.width = "90%";
    SignupStyle.inputStyle.width = "100%";
    SignupStyle.buttonStyle.width = "90%";
  } else if (windowWidth >= 481 && windowWidth <= 768) {
    SignupStyle.width = "80%";
  } else if (windowWidth >= 769 && windowWidth <= 1151) {
    SignupStyle.width = "80%";
    SignupStyle.marginTop = "10%";
  }
  return (
    <div className="Signup">
      <div className="Signup-box" style={SignupStyle}>
        <h1>{"Sign Up"}</h1>
        <p>{"Create a New Account"}</p>
        <form action="" style={SignupStyle.formStyle}>
          <label htmlFor="firstname">{"Firstname:"}</label>
          <span style={SignupStyle.spanStyle}>
            <img src={usernameImage} alt="" style={SignupStyle.imageStyle} />
            <input
              type="text"
              id="firstname"
              placeholder="Firstname"
              style={SignupStyle.inputStyle}
            />
          </span>
          <label htmlFor="surname">{"Surname:"}</label>
          <span style={SignupStyle.spanStyle}>
            <img src={usernameImage} alt="" style={SignupStyle.imageStyle} />
            <input
              type="text"
              id="surname"
              placeholder="Surname"
              style={SignupStyle.inputStyle}
            />
          </span>
          <label htmlFor="username">{"Username:"}</label>
          <span style={SignupStyle.spanStyle}>
            <img src={usernameImage} alt="" style={SignupStyle.imageStyle} />
            <input
              type="text"
              id="username"
              placeholder="Username"
              style={SignupStyle.inputStyle}
            />
          </span>
          <label htmlFor="newpassword">{"New Password:"}</label>
          <span style={SignupStyle.spanStyle}>
            <img src={passwordImage} alt="" style={SignupStyle.imageStyle} />
            <input
              required
              type={passwordVisible ? "text" : "password"}
              id="newpassword"
              placeholder="Password"
              style={SignupStyle.inputStyle}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Icon
              icon={passwordVisible ? eye : eyeOff}
              onClick={togglePasswordVisibility}
            />
          </span>
          <label htmlFor="confirmNewPAssword">{"Confirm Password:"}</label>
          <span style={SignupStyle.spanStyle}>
            <img src={passwordImage} alt="" style={SignupStyle.imageStyle} />
            <input
              required
              type={passwordVisible ? "text" : "password"}
              id="confirmNewPAssword"
              placeholder="Confirm Password"
              style={SignupStyle.inputStyle}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Icon
              icon={passwordVisible ? eye : eyeOff}
              onClick={togglePasswordVisibility}
            />
          </span>
        </form>
        <button style={SignupStyle.buttonStyle}>{"Create Account"}</button>
        <p>
          {"Already Registered? "}
          <span>
            <Link to="/Login">{"Login"}</Link>
          </span>
        </p>
        <p>
          {"Sign Up as Tutor? "}
          <span>
            <Link to="/SignupTutor">{"Sign Up"}</Link>
          </span>
        </p>
      </div>
    </div>
  );
};

export default Signup;
