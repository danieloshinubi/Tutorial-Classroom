import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ForgotPasswordStyle } from "./ForgotPasswordStyle";

const ForgotPassword = () => {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const usernameImage = "/images/username.png";

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
    ForgotPasswordStyle.width = "90%";
    ForgotPasswordStyle.marginTop = "15%";
    ForgotPasswordStyle.height = "auto";
    ForgotPasswordStyle.formStyle.width = "90%";
    ForgotPasswordStyle.inputStyle.width = "100%";
    ForgotPasswordStyle.buttonStyle.width = "90%";
  } else if (windowWidth >= 481 && windowWidth <= 768) {
    ForgotPasswordStyle.width = "80%";
  }else if (windowWidth >= 769 && windowWidth <= 1007) {
    ForgotPasswordStyle.width = "80%";
  }
  return (
    <div className="forgotPassword">
      <div style={ForgotPasswordStyle} className="forgotPassword-box">
        <h1>{"Forgot Password?"}</h1>
        <form action="" style={ForgotPasswordStyle.formStyle}>
          <label htmlFor="emailaddress">{"Email Address:"}</label>
          <span style={ForgotPasswordStyle.spanStyle}>
            <img src={usernameImage} alt="" style={ForgotPasswordStyle.imageStyle} />
            <input
              required
              type="email"
              id="emailaddress"
              placeholder="Email Address"
              style={ForgotPasswordStyle.inputStyle}
            />
          </span>
          <button style={ForgotPasswordStyle.buttonStyle}>{"Send OTP"}</button>
        </form>
        <p>
          {"Remember Password? "}
          <span>
            <Link to="/Login">{"Login"}</Link>
          </span>
        </p>
        <p>
          {"Don't have an account yet? "}
          <span>
            <Link to="/Signup">{"Sign Up"}</Link>
          </span>
        </p>
      </div>
    </div>
  );
};

export default ForgotPassword;
