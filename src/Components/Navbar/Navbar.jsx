import React, { useState, useEffect } from "react";
import Hamburger from "hamburger-react";
import { Link, useLocation } from "react-router-dom";
import { NavbarStyle } from "./NavbarStyle";
import styled from "styled-components";

const Navbar = () => {
  const NavLink = styled(Link)`
    text-decoration: none;
    color: black;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 40px;
    position: relative;

    &:hover {
      color: white;
    }

    &::after {
      content: "";
      position: absolute;
      width: 100%;
      height: 5px;
      bottom: -36px;
      left: 0;
      margin: 0px 0;
    }

    &:hover::after {
      background-color: white;
      transition: all 0.3s ease-out;
    }
  `;

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const location = useLocation();

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const finalyear = "/images/final.jpg";

  if (windowWidth >= 320 && windowWidth <= 480) {
    NavbarStyle.mobileView.display = "none";
    NavbarStyle.align.display = "none";
    NavbarStyle.navDiv.justifyContent = "space-between";
  }

  const navData = [
    { id: "1", word: "Home", path: "/Levels", color: "white" },
    { id: "2", word: "Dashboard", path: "", color: "white" },
    { id: "3", word: "Tutors", path: "", color: "white" },
    { id: "4", word: "Resources", path: "", color: "white" },
  ];

  const getNavLink = (nav) => {
    if (location.pathname === nav.path) {
      return { color: nav.color };
    }
    return null;
  };
  return (
    <div className="Navbar" style={NavbarStyle.navDiv}>
      <span style={NavbarStyle.hamburgerSpan}>
        <Hamburger />
      </span>
      <span style={NavbarStyle.align}>
        <ul style={NavbarStyle}>
          {navData.map((nav, i) => {
            switch (nav.id) {
              case "1":
              case "2":
              case "3":
              case "4":
                return (
                  <li key={nav.id}>
                    <NavLink to={nav.path}>{nav.word}</NavLink>
                  </li>
                );
              default:
                return null;
            }
          })}
        </ul>
      </span>
      <span style={NavbarStyle.placement}>
        <img src={finalyear} alt="" style={NavbarStyle.profImgStyle} />
        <span>
          <p>{`Hello Collins`}</p>
        </span>
      </span>

      {/* not showing for laptop view */}
      <span style={NavbarStyle.mobileView}>
        <ul style={NavbarStyle}>
          {navData.map((nav, i) => {
            switch (nav.id) {
              case "1":
              case "2":
              case "3":
              case "4":
                return (
                  <li key={nav.id}>
                    <Link
                      to={nav.path}
                      style={{ textDecoration: "none", color: "black" }}
                    >
                      {nav.word}
                    </Link>
                  </li>
                );
              default:
                return null;
            }
          })}
        </ul>
      </span>
    </div>
  );
};

export default Navbar;
