import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { eyeOff } from "react-icons-kit/feather/eyeOff";
import { eye } from "react-icons-kit/feather/eye";
import WebFont from "webfontloader";
import { GoogleLogin } from "@react-oauth/google";
import { jwtDecode } from "jwt-decode";
import { LoginStyle } from "./LoginStyle";

const Login = () => {
  const [password, setPassword] = useState("");
  const [type, setType] = useState("password");
  const [icon, setIcon] = useState(eyeOff);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  const passwordImage = "/images/password.png";
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
    LoginStyle.width = "90%";
    LoginStyle.marginTop = "15%";
    LoginStyle.height = "auto";
    LoginStyle.formStyle.width = "90%";
    LoginStyle.inputStyle.width = "100%";
    LoginStyle.buttonStyle.width = "90%";
  } else if (windowWidth >= 481 && windowWidth <= 768) {
    LoginStyle.width = "80%";
  } else if (windowWidth >= 769 && windowWidth <= 1007) {
    LoginStyle.width = "80%";
  }

  return (
    <div className="Login">
      <div style={LoginStyle} className="Login-box">
        <h1>{"Login"}</h1>
        <form action="" style={LoginStyle.formStyle}>
          <label htmlFor="username">{"Username:"}</label>
          <span style={LoginStyle.spanStyle}>
            <img src={usernameImage} alt="" style={LoginStyle.imageStyle} />
            <input
              required
              type="text"
              id="username"
              placeholder="Username"
              style={LoginStyle.inputStyle}
            />
          </span>
          <label htmlFor="password">{"Password:"}</label>
          <span style={LoginStyle.spanStyle}>
            <img src={passwordImage} alt="" style={LoginStyle.imageStyle} />
            <input
              required
              type={type}
              id="password"
              value={password}
              placeholder="Password"
              style={LoginStyle.inputStyle}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Icon
              icon={icon}
              onClick={() => {
                setType(type === "password" ? "text" : "password");
                setIcon(icon === eyeOff ? eye : eyeOff);
              }}
            />
          </span>
        </form>
        <Link to="/Forgot-Password" style={LoginStyle.forgotPasswordStyle}>
          {"Forgot Password?"}
        </Link>
        <button style={LoginStyle.buttonStyle}>{"Login"}</button>
        <p>
          {"Don't have an account yet? "}
          <span>
            <Link to="/Signup">{"Sign Up"}</Link>
          </span>
        </p>{" "}
        <GoogleLogin
          onSuccess={(credentialResponse) => {
            const credentialResponseDecoded = jwtDecode(
              credentialResponse.credential
            );
            console.log(credentialResponseDecoded);
          }}
          onError={() => {
            console.log("Login Failed");
          }}
        />
      </div>
    </div>
  );
};

export default Login;
