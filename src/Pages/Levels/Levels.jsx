import React from "react";
import { Link } from "react-router-dom";

const Levels = () => {
  const styles = {
    margin: "auto",
    marginTop: "10%",
    width: "90%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    boxStyle: {
      backgroundImage: "url(/images/classroom.png)",
      backgroundPosition: "center",
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      opacity: "0.8",
      width: "100%",
      borderRadius: "20px",
      height: "170px",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: "RGBA(128, 128, 128, 0.7)",
    },
    linkStyle: {
      width: "250px",
      textDecoration: "none",
      color: "black",
    },
    headStyle: {
      textAlign: "center",
    },
  };
  const schoolLevels = [
    { year: "100", lvl: "100 lvl" },
    { year: "200", lvl: "200 lvl" },
    { year: "300", lvl: "300 lvl" },
    { year: "400", lvl: "400 lvl" },
  ];
  return (
    <div className="Levels">
      <h1 style={styles.headStyle}>{"Select your level:"}</h1>
      <div className="level-boxes" style={styles}>
        {schoolLevels.map((level, i) => {
          switch (level.year) {
            case "100":
              return (
                <Link to={`/Levels/100/Courses`} style={styles.linkStyle}>
                  <div
                    key={level.lvl}
                    className="level-box"
                    style={styles.boxStyle}
                  >
                    <h2>{level.lvl}</h2>
                  </div>
                </Link>
              );
            case "200":
              return (
                <Link to={`/Levels/200/Courses`} style={styles.linkStyle}>
                  <div
                    key={level.lvl}
                    className="level-box"
                    style={styles.boxStyle}
                  >
                    <h2>{level.lvl}</h2>
                  </div>
                </Link>
              );
            case "300":
              return (
                <Link to={`/Levels/300/Courses`} style={styles.linkStyle}>
                  <div
                    key={level.lvl}
                    className="level-box"
                    style={styles.boxStyle}
                  >
                    <h2>{level.lvl}</h2>
                  </div>
                </Link>
              );
            case "400":
              return (
                <Link to={`/Levels/400/Courses`} style={styles.linkStyle}>
                  <div
                    key={level.lvl}
                    className="level-box"
                    style={styles.boxStyle}
                  >
                    <h2>{level.lvl}</h2>
                  </div>
                </Link>
              );
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
};

export default Levels;
